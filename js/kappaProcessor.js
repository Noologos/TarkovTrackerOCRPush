// js/kappaProcessor.js
import * as State from './state.js';
import * as Config from './config.js';
import * as DOM from './dom.js';
import { reportKappaStatus, reportKappaOutput, showKappaSpinner, drawKappaImageOnCanvas, displayMatchedKappaItems } from './uiKappa.js';
import { updateButtonStates } from './main.js';
import { updateCollapsibleVisibility, showGlobalSpinner, setButtonEnabled } from './ui.js';


export async function processKappaImage() {
    if (!State.kappaState.image) {
        reportKappaStatus('No image uploaded for Kappa items.');
        return;
    }
    if (State.kappaWorker) {
        reportKappaStatus("Processing is already in progress. Please wait or clear current processing.");
        return;
    }

    const wasGlobalSpinnerActive = DOM.globalSpinnerOverlay?.style.display === 'flex';

    showKappaSpinner(true); 
    if (!wasGlobalSpinnerActive) {
        setButtonEnabled(DOM.processAllButton, false);
    }
    updateButtonStates(); 


    reportKappaStatus('Preparing data for Kappa processing worker...');
    reportKappaOutput('Initializing Kappa Item Detection Worker...\n');

    const mainCanvas = document.createElement('canvas');
    mainCanvas.width = State.kappaState.image.naturalWidth;
    mainCanvas.height = State.kappaState.image.naturalHeight;
    const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
    if (!mainCtx) {
        reportKappaStatus("Error: Could not get 2D context for main image.");
        showKappaSpinner(false);
        if (wasGlobalSpinnerActive) showGlobalSpinner(false); // Use imported showGlobalSpinner
        updateButtonStates(); return;
    }
    mainCtx.drawImage(State.kappaState.image, 0, 0);
    let mainImageData;
    try { mainImageData = mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height); }
    catch (e) {
        reportKappaStatus(`Error getting image data: ${e.message}.`);
        console.error("Error in getImageData for main Kappa image:", e);
        showKappaSpinner(false);
        if (wasGlobalSpinnerActive) showGlobalSpinner(false); // Use imported showGlobalSpinner
        updateButtonStates(); return;
    }

    const iconImageDataMap = {};
    const iconTransferList = [mainImageData.data.buffer];

    let iconsToConvertCount = 0;
    let iconsConvertedCount = 0;

    const relevantKappaItems = State.kappaRequiredItemsData.filter(item => item.id);


    for (const item of relevantKappaItems) {
        const mainIconImage = State.kappaRequiredItemIcons[item.id];

        if (mainIconImage) {
            iconsToConvertCount++;
            const iconCanvas = document.createElement('canvas');
            iconCanvas.width = mainIconImage.naturalWidth;
            iconCanvas.height = mainIconImage.naturalHeight;
            const iconCtx = iconCanvas.getContext('2d', { willReadFrequently: true });

            if (iconCtx) {
                iconCtx.drawImage(mainIconImage, 0, 0);
                try {
                    const imgData = iconCtx.getImageData(0, 0, iconCanvas.width, iconCanvas.height);
                    iconImageDataMap[item.id] = imgData;
                    iconTransferList.push(imgData.data.buffer);
                    iconsConvertedCount++;

                } catch (e) {
                    console.error(`Could not getImageData for main icon ${item.name}: ${e.message}`);
                    iconImageDataMap[item.id] = null;
                }
            } else {
                iconImageDataMap[item.id] = null;
            }
        } else {
            iconImageDataMap[item.id] = null;
            if (Config.IS_DEV_MODE) console.log(`Main icon image for ${item.name} (ID: ${item.id}) not found in State.kappaRequiredItemIcons.`);
        }
    }


    reportKappaStatus(`Converted ${iconsConvertedCount}/${iconsToConvertCount} main icons. Starting worker...`);

    const workerInstance = new Worker('./js/kappa-worker.js');
    State.setKappaWorker(workerInstance);

    workerInstance.onmessage = (event) => {
        const { type, message, foundItems, missingItems, phase, processed, total, itemName } = event.data;
        switch (type) {
            case 'status': reportKappaStatus(message); reportKappaOutput(`${message}\n`, true); break;
            case 'progress': reportKappaStatus(`Worker (Pass ${phase || ''}): Item ${processed}/${total} (${itemName})...`); break;
            case 'debug': if (Config.IS_DEV_MODE) reportKappaOutput(`Worker Debug: ${message}\n`, true); console.log(`Worker Debug: ${message}`); break;
            case 'result':
                State.setKappaProcessingResults({ foundItems, missingItems });
                drawKappaImageOnCanvas(); displayMatchedKappaItems();
                reportKappaStatus('Kappa item detection complete.');
                updateCollapsibleVisibility(DOM.kappaDomElements.outputHeader, DOM.kappaDomElements.outputContent, DOM.kappaDomElements.outputArea?.value?.trim().length > 0, Config.IS_DEV_MODE );
                showKappaSpinner(false);
                if (wasGlobalSpinnerActive) showGlobalSpinner(false); // Use imported showGlobalSpinner
                workerInstance.terminate(); State.setKappaWorker(null); updateButtonStates();
                break;
            case 'error':
                reportKappaStatus(`Worker Error: ${message}`); reportKappaOutput(`WORKER ERROR: ${message}\n`, true); console.error(`Worker Error: ${message}`);
                updateCollapsibleVisibility(DOM.kappaDomElements.outputHeader, DOM.kappaDomElements.outputContent, true, Config.IS_DEV_MODE);
                showKappaSpinner(false);
                if (wasGlobalSpinnerActive) showGlobalSpinner(false); // Use imported showGlobalSpinner
                if (State.kappaWorker) { workerInstance.terminate(); State.setKappaWorker(null); } updateButtonStates();
                break;
            default: console.warn("Received unknown message type from Kappa worker:", event.data);
        }
    };
    workerInstance.onerror = (error) => {
        console.error("Error in Kappa Worker:", error.message, error.filename, error.lineno);
        reportKappaStatus(`Critical Worker Error: ${error.message}.`); reportKappaOutput(`CRITICAL WORKER ERROR: ${error.message}\nDetails in console.\n`, true);
        updateCollapsibleVisibility(DOM.kappaDomElements.outputHeader, DOM.kappaDomElements.outputContent, true, Config.IS_DEV_MODE);
        showKappaSpinner(false);
        if (wasGlobalSpinnerActive) showGlobalSpinner(false); // Use imported showGlobalSpinner
        if (State.kappaWorker) { workerInstance.terminate(); State.setKappaWorker(null); } updateButtonStates();
    };

    const workerConfig = {
        KAPPA_PASS1_EARLY_EXIT_CONFIDENCE_THRESHOLD: Config.KAPPA_PASS1_EARLY_EXIT_CONFIDENCE_THRESHOLD,
        KAPPA_PASS1_SCALE_CONFIDENCE_THRESHOLD: Config.KAPPA_PASS1_SCALE_CONFIDENCE_THRESHOLD,
        KAPPA_MATCH_CONFIDENCE_THRESHOLD: Config.KAPPA_MATCH_CONFIDENCE_THRESHOLD,
        KAPPA_NMS_IOU_THRESHOLD: Config.KAPPA_NMS_IOU_THRESHOLD,
        KAPPA_NMS_CONTAINMENT_THRESHOLD: Config.KAPPA_NMS_CONTAINMENT_THRESHOLD,
        KAPPA_NMS_IOU_THRESHOLD_P3_LENIENT: Config.KAPPA_NMS_IOU_THRESHOLD_P3_LENIENT,
        KAPPA_NMS_CONTAINMENT_THRESHOLD_P3_LENIENT: Config.KAPPA_NMS_CONTAINMENT_THRESHOLD_P3_LENIENT
    };

    const opencvScriptTag = document.querySelector(`script[src*="opencv.js"]`);
    const cvPath = opencvScriptTag ? opencvScriptTag.src : Config.OPENCV_SCRIPT_URL;

    if (!cvPath) {
        reportKappaStatus("Error: Could not determine OpenCV script path for worker.");
        console.error("Kappa Processor Error: cvPath is undefined or null.");
        showKappaSpinner(false);
        if (wasGlobalSpinnerActive) showGlobalSpinner(false); // Use imported showGlobalSpinner
        updateButtonStates();
        if (State.kappaWorker) { State.kappaWorker.terminate(); State.setKappaWorker(null); }
        return;
    }

    const workerKappaRequiredItemsData = State.kappaRequiredItemsData.map(item => {
        const mainIcon = State.kappaRequiredItemIcons[item.id];
        return {
            id: item.id, name: item.name, shortName: item.shortName, wikiLink: item.wikiLink,
            originalWidth: mainIcon?.naturalWidth || 0,
            originalHeight: mainIcon?.naturalHeight || 0,
        };
    });

    workerInstance.postMessage({
        imageData: mainImageData,
        kappaRequiredItemsData: workerKappaRequiredItemsData,
        iconImageDataMap: iconImageDataMap,
        config: workerConfig,
        cvPath: cvPath
    }, iconTransferList);
}