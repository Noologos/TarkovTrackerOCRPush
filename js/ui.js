// js/ui.js
import * as DOM from './dom.js';
import * as State from './state.js';
import * as Config from './config.js';
import * as Utils from './utils.js';
import { loadImageFile, drawRect } from './imageUtils.js';
import { processSingleTask } from './taskProcessor.js';
import { updateButtonStates } from './main.js';


export function reportGlobalStatus(message) {
    if (DOM.globalStatusDiv) DOM.globalStatusDiv.textContent = message;
}

export function showGlobalSpinner(show) {
    if (DOM.globalSpinnerOverlay) {
        DOM.globalSpinnerOverlay.style.display = show ? 'flex' : 'none';
    }
}

export function reportTaskStatus(taskName, message) {
    const statusDiv = State.getTask(taskName)?.domElements?.statusDiv;
    if (statusDiv) statusDiv.textContent = message;
}

export function reportTaskOutput(taskName, message, append = false) {
    const outputArea = State.getTask(taskName)?.domElements?.outputArea;
    if (outputArea) {
        outputArea.value = append ? outputArea.value + message : message;
    }
}

export function setButtonEnabled(buttonElement, isEnabled) {
    if (buttonElement) buttonElement.disabled = !isEnabled;
}

export function updateCollapsibleVisibility(header, content, hasDataToShow, initiallyOpen = false) {
    if (!header || !content) return;
    const displayStyle = hasDataToShow ? 'block' : 'none';
    header.style.display = displayStyle;
    content.style.display = (hasDataToShow && initiallyOpen) ? 'block' : 'none';
    header.classList.toggle('active', hasDataToShow && initiallyOpen);
    content.classList.toggle('active', hasDataToShow && initiallyOpen);
}

export function updateMainAndDebugCanvasesDisplay(mainCanvas, debugCanvas, imageIsPresent) {
    if (mainCanvas) {
        mainCanvas.style.display = imageIsPresent ? 'block' : 'none';
    }
    if (debugCanvas) {
        debugCanvas.style.display = imageIsPresent && Config.IS_DEV_MODE ? 'block' : 'none';
    }
}

export function resetTaskOutputUI(domElements) {
    if (!domElements) return;
    const {
        outputArea, outputHeader, outputContent,
        wikiLinksDiv, wikiHeader, wikiContent,
        requiredTasksDiv, requiredTasksHeader, requiredTasksContent,
    } = domElements;

    if (outputArea) outputArea.value = '';
    updateCollapsibleVisibility(outputHeader, outputContent, false);

    if (wikiLinksDiv) wikiLinksDiv.innerHTML = '';
    updateCollapsibleVisibility(wikiHeader, wikiContent, false);

    if (requiredTasksDiv) requiredTasksDiv.innerHTML = '';
    updateCollapsibleVisibility(requiredTasksHeader, requiredTasksContent, false);
}


export function resetTaskSectionUI(taskName) {
    const task = State.getTask(taskName);
    if (!task || !task.domElements) return;
    const { domElements } = task;

    const {
        originalCanvas, processedCanvas, outputArea,
        buttonsContainer, taskButtonsContainer,
        processButton, clearButton, statusDiv, fileInput
    } = domElements;

    originalCanvas?.getContext('2d')?.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
    if (processedCanvas) {
        processedCanvas.getContext('2d')?.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
    }
    updateMainAndDebugCanvasesDisplay(originalCanvas, processedCanvas, false);

    resetTaskOutputUI(domElements);

    if (taskButtonsContainer) taskButtonsContainer.style.display = 'none';
    if (statusDiv) statusDiv.textContent = 'Awaiting image upload.';

    setButtonEnabled(processButton, false);
    setButtonEnabled(clearButton, false);
    if (fileInput) fileInput.value = '';

    State.updateTaskImage(taskName, null);
    State.resetTaskProcessingResults(taskName);
}

export function clearTask(taskName) {
    resetTaskSectionUI(taskName);
    updateButtonStates();
}

// ADD export HERE
export function handleFileDrop(event, targetFileInput, statusReportFn) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('drag-over');

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
        const imageFile = Array.from(files).find(file => file.type.startsWith('image/'));
        if (imageFile) {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(imageFile);
            targetFileInput.files = dataTransfer.files;
            targetFileInput.dispatchEvent(new Event('change', { bubbles: true }));
            if (statusReportFn) statusReportFn('Dropped image successfully.');
            else reportGlobalStatus('Dropped image successfully.'); // Use the exported reportGlobalStatus
        } else {
            if (statusReportFn) statusReportFn('Dropped file is not an image.');
            else reportGlobalStatus('Dropped file is not an image.'); // Use the exported reportGlobalStatus
        }
    }
}


export function initializeTaskUI(taskName) {
    const taskElementId = `task-${taskName.toLowerCase()}`;
    const taskElementHTML = `
        <div class="task-container" id="${taskElementId}" tabindex="0">
            <h3>${taskName}</h3>
            <div class="file-input-container">
                <label for="upload-${taskName.toLowerCase()}">Upload Image (or Drag & Drop here):</label>
                <input type="file" id="upload-${taskName.toLowerCase()}" accept="image/*">
            </div>
            <div class="canvas-container task-canvas-wrapper">
                <canvas class="task-canvas original-canvas"></canvas>
                <canvas class="task-canvas processed-canvas" style="display: ${Config.IS_DEV_MODE ? 'block' : 'none'};"></canvas>
            </div>
            <div class="task-status">Awaiting image upload.</div>
            <div class="task-buttons" style="display: none;">
                <button class="process-task-button" data-task="${taskName}" disabled>Process Image</button>
                <button class="clear-task-button" data-task="${taskName}" disabled>Clear</button>
            </div>
            <div class="collapsible-header" data-target="output-${taskName.toLowerCase()}" style="display: none;">OCR Output</div>
            <div class="collapsible-content" id="output-${taskName.toLowerCase()}" style="display: none;">
                 <textarea class="task-output" readonly></textarea>
            </div>
            <div class="collapsible-header" data-target="wiki-${taskName.toLowerCase()}" style="display: none;">Wiki Links</div>
            <div class="collapsible-content" id="wiki-${taskName.toLowerCase()}" style="display: none;">
                 <div class="wiki-links"></div>
            </div>
            <div class="collapsible-header" data-target="required-tasks-${taskName.toLowerCase()}" style="display: none;">Required Completed Tasks</div>
            <div class="collapsible-content" id="required-tasks-${taskName.toLowerCase()}" style="display: none;">
                 <div class="required-tasks"></div>
            </div>
        </div>
    `;
    const taskElement = Utils.createElementFromHTML(taskElementHTML);
    if (!DOM.taskImagesGrid || !taskElement) return;
    DOM.taskImagesGrid.appendChild(taskElement);

    const domElements = {
        taskElement: taskElement,
        originalCanvas: taskElement.querySelector('.original-canvas'),
        originalCtx: taskElement.querySelector('.original-canvas').getContext('2d'),
        processedCanvas: taskElement.querySelector('.processed-canvas'),
        processedCtx: taskElement.querySelector('.processed-canvas').getContext('2d'),
        statusDiv: taskElement.querySelector('.task-status'),
        outputArea: taskElement.querySelector('.task-output'),
        wikiLinksDiv: taskElement.querySelector('.wiki-links'),
        requiredTasksDiv: taskElement.querySelector('.required-tasks'),
        outputHeader: taskElement.querySelector(`.collapsible-header[data-target="output-${taskName.toLowerCase()}"]`),
        outputContent: taskElement.querySelector(`#output-${taskName.toLowerCase()}`),
        wikiHeader: taskElement.querySelector(`.collapsible-header[data-target="wiki-${taskName.toLowerCase()}"]`),
        wikiContent: taskElement.querySelector(`#wiki-${taskName.toLowerCase()}`),
        requiredTasksHeader: taskElement.querySelector(`.collapsible-header[data-target="required-tasks-${taskName.toLowerCase()}"]`),
        requiredTasksContent: taskElement.querySelector(`#required-tasks-${taskName.toLowerCase()}`),
        fileInput: taskElement.querySelector('input[type="file"]'),
        processButton: taskElement.querySelector('.process-task-button'),
        clearButton: taskElement.querySelector('.clear-task-button'),
        taskButtonsContainer: taskElement.querySelector('.task-buttons')
    };

    State.addTask(taskName, {
        image: null,
        domElements: domElements,
        processingResults: State.createInitialTaskProcessingResults()
    });

    domElements.taskElement.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.add('drag-over');
    });
    domElements.taskElement.addEventListener('dragleave', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');
    });
    domElements.taskElement.addEventListener('drop', (event) => {
        handleFileDrop(event, domElements.fileInput, (message) => reportTaskStatus(taskName, message));
    });


    domElements.fileInput?.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        loadImageFile(file, (img) => {
            if (!img) {
                reportTaskStatus(taskName, 'Error loading image.');
                return;
            }
            State.updateTaskImage(taskName, img);
            const { originalCanvas, originalCtx, processedCanvas, processedCtx, taskButtonsContainer, processButton, clearButton } = domElements;

            originalCanvas.width = img.naturalWidth;
            originalCanvas.height = img.naturalHeight;
            originalCtx.clearRect(0, 0, img.naturalWidth, img.naturalHeight);
            originalCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);

            if (processedCanvas) {
                processedCanvas.width = img.naturalWidth;
                processedCanvas.height = img.naturalHeight;
                processedCtx?.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
            }
            updateMainAndDebugCanvasesDisplay(originalCanvas, processedCanvas, true);

            reportTaskStatus(taskName, 'Image uploaded. Ready to process.');
            State.resetTaskProcessingResults(taskName);
            resetTaskOutputUI(domElements);
            if (taskButtonsContainer) taskButtonsContainer.style.display = 'flex';
            setButtonEnabled(processButton, true);
            setButtonEnabled(clearButton, true);
            updateButtonStates();
        });
    });

    domElements.processButton?.addEventListener('click', async () => await processSingleTask(taskName));
    domElements.clearButton?.addEventListener('click', () => clearTask(taskName));

    resetTaskSectionUI(taskName);
}

export function drawTaskImageOnCanvas(taskName) {
     const task = State.getTask(taskName);
     if (!task?.image || !task.domElements?.originalCanvas || !task.domElements.originalCtx) return;

     const { image, processingResults } = task;
     const { originalCanvas, originalCtx: ctx } = task.domElements;
     const { naturalWidth: width, naturalHeight: height } = image;

     originalCanvas.width = width;
     originalCanvas.height = height;
     ctx.clearRect(0, 0, width, height);
     ctx.drawImage(image, 0, 0, width, height);

     if (processingResults.ocrRect) {
         ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
         if (processingResults.ocrRect.top > 0) ctx.fillRect(0, 0, width, processingResults.ocrRect.top);
         const ocrBottom = processingResults.ocrRect.top + processingResults.ocrRect.height;
         if (ocrBottom < height) ctx.fillRect(0, ocrBottom, width, height - ocrBottom);
         if (processingResults.ocrRect.left > 0) ctx.fillRect(0, processingResults.ocrRect.top, processingResults.ocrRect.left, processingResults.ocrRect.height);
         const ocrRight = processingResults.ocrRect.left + processingResults.ocrRect.width;
         if (ocrRight < width) ctx.fillRect(ocrRight, processingResults.ocrRect.top, width - ocrRight, processingResults.ocrRect.height);
     }

     if (processingResults.discriminant1Rect) drawRect(ctx, processingResults.discriminant1Rect, 'rgba(0, 255, 0, 1.0)', 2);
     if (processingResults.discriminant2Rect) drawRect(ctx, processingResults.discriminant2Rect, 'rgba(0, 0, 255, 1.0)', 2);
     if (processingResults.ocrRect) drawRect(ctx, processingResults.ocrRect, 'rgba(255, 255, 0, 1.0)', 2);
}