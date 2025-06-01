// js/main.js
/* global cv, Fuse, Tesseract */
import * as Config from './config.js';
import * as DOM from './dom.js';
import * as State from './state.js';
import * as Utils from './utils.js';
import * as UI from './ui.js';
import * as UIKappa from './uiKappa.js';
import * as ImageUtils from './imageUtils.js';
import * as API from './api.js';
import { processSingleTask } from './taskProcessor.js';
import { processKappaImage } from './kappaProcessor.js';

// Add references to new DOM elements for the modal
const examplesModal = document.getElementById('examples-modal');
const showExamplesButton = document.getElementById('show-examples-button');
const closeModalButton = document.querySelector('#examples-modal .close-button');


async function initializeApp() {
    UI.reportGlobalStatus('Loading dependencies...');

    const savedApiKey = Utils.loadApiKey();
    if (DOM.apiKeyInput && savedApiKey) {
        DOM.apiKeyInput.value = savedApiKey;
    }

    Config.TRADER_NAMES.forEach(taskName => UI.initializeTaskUI(taskName));
    if (DOM.kappaItemsSection) {
        UIKappa.initializeKappaUI();
    }

    try {
        await waitForOpenCV();
        UI.reportGlobalStatus('OpenCV ready. Loading data...');

        const [
            discriminant1,
            discriminant2
        ] = await Promise.all([
            new Promise((res, rej) => ImageUtils.loadImageFromUrl(Config.DISCRIMINANT_IMAGE_PATHS[0], img => { State.setDiscriminantImage1(img); res(img); }, rej)),
            new Promise((res, rej) => ImageUtils.loadImageFromUrl(Config.DISCRIMINANT_IMAGE_PATHS[1], img => { State.setDiscriminantImage2(img); res(img); }, rej)),
        ]);

        await API.fetchTarkovData();

        if (!State.discriminantImage1 || !State.discriminantImage2) {
            throw new Error("Failed to load discriminant images.");
        }
        if (State.tarkovTasksData.length === 0) {
            UI.reportGlobalStatus('Failed to load Tarkov task data. Some features might not work.');
        }

    } catch (error) {
        console.error("Error during app initialization:", error);
        UI.reportGlobalStatus(`Initialization Error: ${error.message}. App may not function correctly. Check console.`);
    } finally {
        updateButtonStates();
        // Set initial focus to the first task container if available
        const firstTaskEl = DOM.taskImagesGrid?.querySelector('.task-container');
        if (firstTaskEl) {
             firstTaskEl.focus();
             firstTaskEl.classList.add('focused');
        } else if (DOM.kappaItemsSection) {
            DOM.kappaItemsSection.focus();
            DOM.kappaItemsSection.classList.add('focused');
        }
    }
}

function waitForOpenCV() {
    return new Promise((resolve, reject) => {
        if (typeof cv !== 'undefined' && cv.then instanceof Function) {
            cv.then((cvInstance) => {
                window.cv = cvInstance;
                resolve(cvInstance);
            }).catch(err => {
                console.error("OpenCV initialization via .then failed:", err);
                reject(err);
            });
        } else if (typeof cv !== 'undefined' && cv.Mat) {
            resolve(cv);
        } else {
            let attempts = 0;
            const interval = setInterval(() => {
                attempts++;
                if (typeof cv !== 'undefined' && cv.then instanceof Function) {
                    clearInterval(interval);
                    cv.then((cvInstance) => { window.cv = cvInstance; resolve(cvInstance); }).catch(reject);
                } else if (typeof cv !== 'undefined' && cv.Mat) {
                    clearInterval(interval);
                    resolve(cv);
                } else if (attempts > 60) {
                    clearInterval(interval);
                    reject(new Error("OpenCV.js not loaded after extended wait."));
                }
            }, 100);
        }
    });
}

function setupEventListeners() {
    DOM.apiKeyInput?.addEventListener('input', (event) => {
        Utils.saveApiKey(event.target.value);
        updateButtonStates();
    });

    DOM.processAllButton?.addEventListener('click', async () => {
        if (!State.discriminantImage1 || !State.discriminantImage2 || State.tarkovTasksData.length === 0 || !State.fuse) {
            UI.reportGlobalStatus('Error: Core dependencies for task processing not loaded.');
            return;
        }
        const canProcessKappa = State.kappaState.image &&
                                State.kappaRequiredItemsData.length > 0 &&
                                Object.values(State.kappaRequiredItemIcons).filter(icon => icon !== null).length > 0 &&
                                !State.kappaWorker;
        const anyTaskImageUploaded = Config.TRADER_NAMES.some(name => State.getTask(name)?.image !== null);
        if (!anyTaskImageUploaded && !State.kappaState.image) {
            UI.reportGlobalStatus('No images uploaded to process.');
            return;
        }

        UI.setButtonEnabled(DOM.processAllButton, false);
        UI.setButtonEnabled(DOM.postCompletedTasksButton, false);
        UI.showGlobalSpinner(true);
        UI.reportGlobalStatus('Starting processing all uploaded images...');
        let processingErrorOccurred = false;
        try {
            for (const taskName of Config.TRADER_NAMES) {
                if (State.getTask(taskName)?.image) {
                    UI.reportGlobalStatus(`Processing ${taskName}...`);
                    await processSingleTask(taskName);
                }
            }
            if (State.kappaState.image) {
                if (canProcessKappa) {
                    UI.reportGlobalStatus('Processing Kappa image...');
                    await processKappaImage();
                } else {
                    let kappaSkipReason = "Kappa image uploaded, but skipping: ";
                    if (!State.kappaRequiredItemsData.length) kappaSkipReason += "Kappa item data not loaded. ";
                    else if (Object.values(State.kappaRequiredItemIcons).filter(icon => icon !== null).length === 0) kappaSkipReason += "No Kappa item icons loaded. ";
                    else if (State.kappaWorker) kappaSkipReason += "Kappa processing already in progress. ";
                    else kappaSkipReason += "Prerequisites not met. ";
                    UI.reportGlobalStatus(kappaSkipReason);
                    console.warn(kappaSkipReason, State.kappaState, State.kappaRequiredItemsData, State.kappaRequiredItemIcons, State.kappaWorker);
                }
            }
            UI.reportGlobalStatus('Processing of all initiated images complete (Kappa may be running in background).');
        } catch (error) {
            console.error("Error during 'Process All':", error);
            UI.reportGlobalStatus(`Error during 'Process All': ${error.message}. Check console.`);
            processingErrorOccurred = true;
        } finally {
            if (!State.kappaWorker || !State.kappaState.image || !canProcessKappa) {
                UI.showGlobalSpinner(false);
                updateButtonStates();
            } else if (processingErrorOccurred) {
                 UI.showGlobalSpinner(false);
                 updateButtonStates();
            }
        }
    });

    DOM.postCompletedTasksButton?.addEventListener('click', async () => {
        await API.postCompletedTasksToTracker();
        updateButtonStates();
    });

    // Event listeners for the examples modal
    showExamplesButton?.addEventListener('click', () => {
        if (examplesModal) examplesModal.style.display = 'flex';
    });

    closeModalButton?.addEventListener('click', () => {
        if (examplesModal) examplesModal.style.display = 'none';
    });

    window.addEventListener('click', (event) => {
        if (event.target === examplesModal) {
            examplesModal.style.display = 'none';
        }
    });
    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && examplesModal && examplesModal.style.display !== 'none') {
            examplesModal.style.display = 'none';
        }
    });

    // Focus management on click
    DOM.container?.addEventListener('click', (event) => {
        const header = event.target.closest('.collapsible-header');
        if (header instanceof HTMLElement && header.style.display !== 'none') {
            const contentId = header.dataset?.target;
            if (contentId) {
                const contentElement = document.getElementById(contentId);
                if (contentElement) {
                    const isActive = contentElement.classList.toggle('active');
                    header.classList.toggle('active', isActive);
                    contentElement.style.display = isActive ? 'block' : 'none';
                }
            }
        }

        const targetElement = event.target.closest('.task-container, .kappa-items-container');
        if (targetElement) {
            document.querySelectorAll('.task-container, .kappa-items-container').forEach(el => el.classList.remove('focused'));
            targetElement.classList.add('focused');
        }
    });

    // Paste functionality
    DOM.container?.addEventListener('paste', (event) => {
        const imageFile = Array.from(event.clipboardData?.items ?? [])
            .find(item => item.type.includes('image'))
            ?.getAsFile();

        if (!imageFile) {
            if (event.clipboardData?.items?.length > 0) {
                UI.reportGlobalStatus('Pasted content is not an image.');
            }
            return;
        }
        event.preventDefault();

        const focusedEl = DOM.container.querySelector('.task-container.focused, .kappa-items-container.focused');
        let targetFileInput = null;

        if (focusedEl) {
            if (focusedEl.classList.contains('task-container')) {
                const taskNameRaw = focusedEl.id.replace('task-', '');
                const taskKey = Config.TRADER_NAMES.find(tn => tn.toLowerCase() === taskNameRaw.toLowerCase());
                targetFileInput = taskKey ? State.getTask(taskKey)?.domElements?.fileInput : null;
            } else if (focusedEl.classList.contains('kappa-items-container')) {
                targetFileInput = DOM.kappaDomElements.fileInput;
            }
        }

        if (targetFileInput) {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(imageFile);
            targetFileInput.files = dataTransfer.files;
            targetFileInput.dispatchEvent(new Event('change', { bubbles: true }));
             UI.reportGlobalStatus(`Pasted image into focused section.`);
        } else {
            UI.reportGlobalStatus('Pasted image, but no suitable target section is focused or found.');
        }
    });

    // Tab key focus cycling for task/kappa containers
    DOM.container?.addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
            const focusableElements = Array.from(
                DOM.container.querySelectorAll('.task-container[tabindex="0"], .kappa-items-container[tabindex="0"]')
            ).filter(el => el.offsetParent !== null); 

            if (focusableElements.length <= 1) return; 

            const currentlyFocusedElement = document.activeElement;
            let currentIndex = focusableElements.findIndex(el => el === currentlyFocusedElement);

            if (currentIndex === -1 && focusableElements.includes(event.target)) {
                 currentIndex = focusableElements.findIndex(el => el === event.target);
            }

            if (currentIndex !== -1 || (event.target && focusableElements.includes(event.target))) {
                 event.preventDefault(); 

                let nextIndex;
                if (event.shiftKey) { 
                    nextIndex = (currentIndex - 1 + focusableElements.length) % focusableElements.length;
                } else { 
                    nextIndex = (currentIndex + 1) % focusableElements.length;
                }

                const nextElement = focusableElements[nextIndex];
                if (nextElement) {
                    document.querySelectorAll('.task-container, .kappa-items-container').forEach(el => el.classList.remove('focused'));
                    nextElement.classList.add('focused');
                    nextElement.focus();
                }
            }
        }
    });

    const allContainers = DOM.container?.querySelectorAll('.task-container[tabindex="0"], .kappa-items-container[tabindex="0"]');
    allContainers?.forEach(containerEl => {
        containerEl.addEventListener('focus', () => {
            document.querySelectorAll('.task-container.focused, .kappa-items-container.focused').forEach(el => el.classList.remove('focused'));
            containerEl.classList.add('focused');
        });
    });
}

export function updateButtonStates() {
    const dataFetched = State.tarkovTasksData.length > 0 && State.fuse &&
                        State.discriminantImage1 && State.discriminantImage2;
    const apiKeyPresent = DOM.apiKeyInput?.value.trim() !== '';
    const cvReady = typeof cv !== 'undefined' && typeof cv.imread === 'function';
    const tesseractReady = typeof Tesseract !== 'undefined' && typeof Tesseract.createWorker === 'function';
    const fuseReady = typeof Fuse !== 'undefined';

    const isGlobalProcessing = DOM.globalSpinnerOverlay?.style.display === 'flex' || State.kappaWorker;


    if (!cvReady) UI.reportGlobalStatus('OpenCV.js is loading or failed to load...');
    else if (!tesseractReady) UI.reportGlobalStatus('Tesseract.js is loading or failed to load...');
    else if (!fuseReady) UI.reportGlobalStatus('Fuse.js is loading or failed to load...');
    else if (!dataFetched && (State.discriminantImage1 && State.discriminantImage2) ) UI.reportGlobalStatus('Core images loaded. Fetching Tarkov data...');
    else if (!dataFetched) UI.reportGlobalStatus('Loading core data and images...');
    else {
        const kappaIconsLoadedCount = Object.values(State.kappaRequiredItemIcons).filter(icon => icon !== null).length;
        const relevantKappaItemsWithId = State.kappaRequiredItemsData.filter(item => item && item.id).length;
        const iconStatus = relevantKappaItemsWithId > 0
            ? `Kappa icons: ${kappaIconsLoadedCount}/${relevantKappaItemsWithId} loaded.`
            : (State.kappaRequiredItemsData.length > 0 ? 'No Kappa items with IDs found in data.' : 'Kappa item data not available.');

        if (!isGlobalProcessing) {
            UI.reportGlobalStatus(`All core dependencies ready. Task data loaded. ${iconStatus}`);
        }
    }

    const anyTaskImageUploaded = Config.TRADER_NAMES.some(name => State.getTask(name)?.image !== null);
    const kappaImageUploaded = State.kappaState.image !== null;

    UI.setButtonEnabled(DOM.processAllButton,
        dataFetched &&
        (anyTaskImageUploaded || kappaImageUploaded) &&
        cvReady && tesseractReady &&
        !isGlobalProcessing);


    const anyTaskHasRequiredToPost = Config.TRADER_NAMES.some(name =>
        State.getTask(name)?.processingResults?.requiredTasksToPost?.length > 0
    );
    UI.setButtonEnabled(DOM.postCompletedTasksButton, anyTaskHasRequiredToPost && apiKeyPresent && !isGlobalProcessing);

    if (DOM.kappaDomElements.processButton) {
        const kappaIconsLoadedCount = Object.values(State.kappaRequiredItemIcons).filter(icon => icon !== null).length;
        const relevantKappaItemsWithId = State.kappaRequiredItemsData.filter(item => item && item.id).length;

        const kappaItemDataReady = dataFetched &&
            (relevantKappaItemsWithId === 0 || kappaIconsLoadedCount > 0 || State.kappaRequiredItemsData.length === 0);

        const kappaProcessEnabled =
            kappaImageUploaded &&
            kappaItemDataReady &&
            cvReady &&
            !State.kappaWorker &&
            !isGlobalProcessing;

        UI.setButtonEnabled(DOM.kappaDomElements.processButton, kappaProcessEnabled);
        UI.setButtonEnabled(DOM.kappaDomElements.clearButton, kappaImageUploaded && !State.kappaWorker && !isGlobalProcessing);
    }

    Config.TRADER_NAMES.forEach(name => {
        const task = State.getTask(name);
        if (task && task.domElements) {
            const imageUploaded = task.image !== null;
            UI.setButtonEnabled(task.domElements.processButton, imageUploaded && dataFetched && cvReady && tesseractReady && !isGlobalProcessing);
            UI.setButtonEnabled(task.domElements.clearButton, imageUploaded && !isGlobalProcessing);
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});