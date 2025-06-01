// js/uiKappa.js
import * as DOM from './dom.js';
import *  as State from './state.js';
import * as Config from './config.js';
import { loadImageFile } from './imageUtils.js';
// Import handleFileDrop from ui.js (or a shared utils file if you create one)
import { setButtonEnabled, updateCollapsibleVisibility, updateMainAndDebugCanvasesDisplay, handleFileDrop } from './ui.js';
import { processKappaImage as startKappaProcessing } from './kappaProcessor.js';
import { updateButtonStates } from './main.js';

const TARGET_1x1_SIZE_DRAW = 64;
const SIZE_TOLERANCE_PERCENT_1x1_DRAW = 0.20;
const ASPECT_RATIO_TOLERANCE_1x1_DRAW = 0.20;
const FIXED_CROP_1x1_HORIZONTAL_DRAW = 15;
const PERCENT_CROP_TOP_GENERAL_DRAW = 0.10;
const PERCENT_CROP_HORIZONTAL_GENERAL_DRAW = 0.05;

const PERCENT_CROP_AGGRESSIVE_VERTICAL_P3_DRAW = 0.25;
const PERCENT_CROP_AGGRESSIVE_HORIZONTAL_P3_DRAW = 0.25;
const MINIMAL_FALLBACK_CROP_PERCENT_DRAW = 0.02;

function drawSmartRect(ctx, x, y, width, height, rotationDegrees = 0, color = 'red', lineWidth = 2) {
    if (!ctx || width <= 0 || height <= 0) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([]);

    if (rotationDegrees === 0 || rotationDegrees % 360 === 0) { 
        ctx.strokeRect(x, y, width, height);
    } else {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate(rotationDegrees * Math.PI / 180);
        ctx.strokeRect(-width / 2, -height / 2, width, height);
    }
    ctx.restore();
}

export function reportKappaStatus(message) { if (DOM.kappaDomElements.statusDiv) DOM.kappaDomElements.statusDiv.textContent = message; }
export function reportKappaOutput(message, append = false) { if (DOM.kappaDomElements.outputArea) DOM.kappaDomElements.outputArea.value = append ? DOM.kappaDomElements.outputArea.value + message : message; }
export function showKappaSpinner(show) { if (DOM.kappaSpinner) DOM.kappaSpinner.style.display = show ? 'flex' : 'none'; }
export function resetKappaOutputUI() {
    if (!DOM.kappaDomElements) return;
    const { outputArea, outputHeader, outputContent, matchedItemsListDiv, matchedItemsHeader, matchedItemsContent } = DOM.kappaDomElements;
    if (outputArea) outputArea.value = '';
    updateCollapsibleVisibility(outputHeader, outputContent, false);
    if (matchedItemsListDiv) matchedItemsListDiv.innerHTML = '';
    updateCollapsibleVisibility(matchedItemsHeader, matchedItemsContent, false);
}
export function resetKappaSectionUI() {
    if (!DOM.kappaDomElements) return;
    const { originalCanvas, processedCanvas, buttonsContainer, processButton, clearButton, statusDiv, fileInput } = DOM.kappaDomElements;
    originalCanvas?.getContext('2d')?.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
    if (processedCanvas) processedCanvas.getContext('2d')?.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
    updateMainAndDebugCanvasesDisplay(originalCanvas, processedCanvas, false);
    resetKappaOutputUI();
    if (buttonsContainer) buttonsContainer.style.display = 'none';
    if (statusDiv) statusDiv.textContent = 'Awaiting image upload.';
    setButtonEnabled(processButton, false); setButtonEnabled(clearButton, false);
    if (fileInput) fileInput.value = '';
    State.setKappaImage(null); State.resetKappaProcessingResults();
}
export function initializeKappaUI() {
    if (!DOM.kappaItemsSection || !DOM.kappaDomElements.fileInput) { console.warn("Kappa items section not found."); return; }

    // Update label for drag & drop hint
    const kappaLabel = DOM.kappaItemsSection.querySelector('label[for="upload-kappa-items"]');
    if (kappaLabel) {
        kappaLabel.textContent = "Upload Kappa Items Image (or Drag & Drop here):";
    }

    DOM.kappaDomElements.processButton?.addEventListener('click', startKappaProcessing);
    DOM.kappaDomElements.clearButton?.addEventListener('click', () => {
        if (State.kappaWorker) { State.kappaWorker.terminate(); State.setKappaWorker(null); showKappaSpinner(false); reportKappaStatus("Processing cancelled."); }
        State.setKappaImage(null); State.resetKappaProcessingResults(); resetKappaSectionUI(); updateButtonStates();
    });

    // Drag and Drop listeners for the Kappa container
    DOM.kappaItemsSection.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.add('drag-over');
    });
    DOM.kappaItemsSection.addEventListener('dragleave', (event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove('drag-over');
    });
    DOM.kappaItemsSection.addEventListener('drop', (event) => {
        handleFileDrop(event, DOM.kappaDomElements.fileInput, reportKappaStatus);
    });


    DOM.kappaDomElements.fileInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0]; if (!file) return;
        if (State.kappaWorker) { reportKappaStatus("Cannot load new image while processing."); event.target.value = ''; return; }
        loadImageFile(file, (img) => {
            if (!img) { reportKappaStatus("Error loading Kappa image."); return; }
            State.setKappaImage(img);
            const { originalCanvas, processedCanvas, buttonsContainer } = DOM.kappaDomElements;
            if (originalCanvas) {
                const ctx = originalCanvas.getContext('2d'); originalCanvas.width = img.naturalWidth; originalCanvas.height = img.naturalHeight;
                ctx?.clearRect(0, 0, img.naturalWidth, img.naturalHeight); ctx?.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
            }
            if (processedCanvas) { const pCtx = processedCanvas.getContext('2d'); processedCanvas.width = img.naturalWidth; processedCanvas.height = img.naturalHeight; pCtx?.clearRect(0, 0, img.naturalWidth, img.naturalHeight); }
            updateMainAndDebugCanvasesDisplay(originalCanvas, processedCanvas, true);
            reportKappaStatus('Image uploaded. Ready to process.'); State.resetKappaProcessingResults(); resetKappaOutputUI();
            if (buttonsContainer) buttonsContainer.style.display = 'flex';
            updateButtonStates();
        });
    });
    resetKappaSectionUI();
}

export function drawKappaImageOnCanvas() {
     const { image, processingResults } = State.kappaState;
     const originalCtx = DOM.kappaDomElements.originalCanvas?.getContext('2d');
     if (!image || !DOM.kappaDomElements.originalCanvas || !originalCtx) return;

     const { naturalWidth: viewWidth, naturalHeight: viewHeight } = image;
     DOM.kappaDomElements.originalCanvas.width = viewWidth;
     DOM.kappaDomElements.originalCanvas.height = viewHeight;
     originalCtx.clearRect(0, 0, viewWidth, viewHeight);
     originalCtx.drawImage(image, 0, 0, viewWidth, viewHeight);

     processingResults.foundItems.forEach(itemResult => {
         const itemName = itemResult.item.shortName || itemResult.item.name;

         if (itemResult.location) {
            const matchLocation = itemResult.location;
            const matchScale = itemResult.scale;
            const matchPass = itemResult.pass;
            const matchRotationDeg = itemResult.rotation || 0;

            let x_for_drawSmartRect, y_for_drawSmartRect;
            let w_for_drawSmartRect, h_for_drawSmartRect;

            const originalIconImage = State.kappaRequiredItemIcons[itemResult.item.id];
            const boxLineWidth = 2;

            if (originalIconImage && typeof matchScale === 'number') {
                w_for_drawSmartRect = originalIconImage.naturalWidth * matchScale;
                h_for_drawSmartRect = originalIconImage.naturalHeight * matchScale;

                if (matchRotationDeg === 0) {
                    let scaledTopCropOffset = 0;
                    let scaledLeftCropOffset = 0;
                    const assetWidth = originalIconImage.naturalWidth;
                    const assetHeight = originalIconImage.naturalHeight;

                    if (itemResult.cropType === 'cropped') {
                        if (matchPass === 1 || matchPass === 2) {
                            let topCropPx_asset = Math.floor(assetHeight * PERCENT_CROP_TOP_GENERAL_DRAW);
                            let leftCropPx_asset;
                            const aspectRatio = assetWidth / assetHeight;
                            const avgDimension = (assetWidth + assetHeight) / 2;
                            const isNearSquare = aspectRatio >= (1 - ASPECT_RATIO_TOLERANCE_1x1_DRAW) && aspectRatio <= (1 + ASPECT_RATIO_TOLERANCE_1x1_DRAW);
                            const isNearTargetSize = avgDimension >= TARGET_1x1_SIZE_DRAW * (1 - SIZE_TOLERANCE_PERCENT_1x1_DRAW) &&
                                                   avgDimension <= TARGET_1x1_SIZE_DRAW * (1 + SIZE_TOLERANCE_PERCENT_1x1_DRAW);
                            if (isNearSquare && isNearTargetSize) {
                                leftCropPx_asset = FIXED_CROP_1x1_HORIZONTAL_DRAW;
                                if (leftCropPx_asset * 2 >= assetWidth) {
                                    leftCropPx_asset = Math.floor(assetWidth * PERCENT_CROP_HORIZONTAL_GENERAL_DRAW);
                                    if (leftCropPx_asset * 2 >= assetWidth) {
                                        leftCropPx_asset = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT_DRAW));
                                    }
                                }
                            } else {
                                leftCropPx_asset = Math.floor(assetWidth * PERCENT_CROP_HORIZONTAL_GENERAL_DRAW);
                                if (leftCropPx_asset * 2 >= assetWidth) {
                                    leftCropPx_asset = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT_DRAW));
                                }
                            }
                            if (topCropPx_asset >= assetHeight) {
                                topCropPx_asset = Math.max(0, Math.floor(assetHeight * MINIMAL_FALLBACK_CROP_PERCENT_DRAW));
                            }
                            scaledTopCropOffset = topCropPx_asset * matchScale;
                            scaledLeftCropOffset = leftCropPx_asset * matchScale;
                        } else if (matchPass === 3) {
                            let topCropPx_P3 = Math.floor(assetHeight * PERCENT_CROP_AGGRESSIVE_VERTICAL_P3_DRAW);
                            let leftCropPx_P3 = Math.floor(assetWidth * PERCENT_CROP_AGGRESSIVE_HORIZONTAL_P3_DRAW);
                            if ((topCropPx_P3 * 2) >= assetHeight) {
                                topCropPx_P3 = Math.max(0, Math.floor(assetHeight * MINIMAL_FALLBACK_CROP_PERCENT_DRAW));
                            }
                            if ((leftCropPx_P3 * 2) >= assetWidth) {
                                leftCropPx_P3 = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT_DRAW));
                            }
                            scaledTopCropOffset = topCropPx_P3 * matchScale;
                            scaledLeftCropOffset = leftCropPx_P3 * matchScale;
                        }
                    }
                    x_for_drawSmartRect = matchLocation.left - scaledLeftCropOffset;
                    y_for_drawSmartRect = matchLocation.top - scaledTopCropOffset;
                } else {
                    const matchedFeatureCenterX = matchLocation.left + matchLocation.width / 2;
                    const matchedFeatureCenterY = matchLocation.top + matchLocation.height / 2;
                    x_for_drawSmartRect = matchedFeatureCenterX - w_for_drawSmartRect / 2;
                    y_for_drawSmartRect = matchedFeatureCenterY - h_for_drawSmartRect / 2;
                }
            } else {
                x_for_drawSmartRect = matchLocation.left;
                y_for_drawSmartRect = matchLocation.top;
                w_for_drawSmartRect = matchLocation.width;
                h_for_drawSmartRect = matchLocation.height;
                if (Config.IS_DEV_MODE && !originalIconImage) console.warn(`Original icon image not found for ${itemName}`);
                if (Config.IS_DEV_MODE && typeof matchScale !== 'number') console.warn(`Match scale not available for ${itemName}`);
            }

            drawSmartRect(originalCtx, x_for_drawSmartRect, y_for_drawSmartRect, w_for_drawSmartRect, h_for_drawSmartRect,
                          matchRotationDeg, 'rgba(0, 255, 0, 1.0)', boxLineWidth);

            originalCtx.save();
            originalCtx.fillStyle = 'rgba(0, 255, 0, 1.0)';
            originalCtx.font = 'bold 12px sans-serif';
            originalCtx.strokeStyle = 'black';
            originalCtx.lineWidth = 2;
            originalCtx.textBaseline = 'top';

            let textAnchorX, textAnchorY;
            const clearInsidePadding = 3;
            const textPadding = (boxLineWidth / 2) + clearInsidePadding;


            if (matchRotationDeg === 0 || matchRotationDeg % 360 === 0) {
                textAnchorX = x_for_drawSmartRect + textPadding;
                textAnchorY = y_for_drawSmartRect + textPadding;
            } else if (matchRotationDeg === 90 || matchRotationDeg === -270) {
                const featureCenterX = x_for_drawSmartRect + w_for_drawSmartRect / 2;
                const featureCenterY = y_for_drawSmartRect + h_for_drawSmartRect / 2;

                const visualBoxTopLeftX = featureCenterX - h_for_drawSmartRect / 2;
                const visualBoxTopLeftY = featureCenterY - w_for_drawSmartRect / 2;

                textAnchorX = visualBoxTopLeftX + textPadding;
                textAnchorY = visualBoxTopLeftY + textPadding;
            } else {
                textAnchorX = x_for_drawSmartRect + textPadding;
                textAnchorY = y_for_drawSmartRect + textPadding;
                if (Config.IS_DEV_MODE) {
                    console.warn(`Unhandled rotation ${matchRotationDeg} for text placement of item ${itemName}. Defaulting to unrotated placement.`);
                }
            }

            originalCtx.strokeText(itemName, textAnchorX, textAnchorY);
            originalCtx.fillText(itemName, textAnchorX, textAnchorY);
            originalCtx.restore();
         }
     });
}


export function displayMatchedKappaItems() {
    if (!DOM.kappaDomElements.matchedItemsListDiv) return;
    let itemsHtml = '';
    const { missingItems, foundItems } = State.kappaState.processingResults;

    if (foundItems.length > 0) {
        itemsHtml += '<h4>Found Items:</h4><ul>';
        const sortedFoundItems = [...foundItems].sort((a,b) => (a.item.name || "").localeCompare(b.item.name || ""));
        sortedFoundItems.forEach(fi => {
            let displayText = `<li>${fi.item.name} (ID: ${fi.item.id || 'N/A'})`;
            if (typeof fi.confidence === 'number') {
                displayText += ` (Conf: ${fi.confidence.toFixed(2)}`;
                if (typeof fi.scale === 'number') displayText += `, Scale: ${fi.scale.toFixed(2)}`;
                if (typeof fi.pass === 'number') displayText += `, Pass: ${fi.pass}`;
                if (typeof fi.rotation === 'number' && fi.rotation !== 0) displayText += `, Rot: ${fi.rotation}°`;
                if (fi.cropType) displayText += `, Crop: ${fi.cropType}`;
                displayText += `)`;
            }
            displayText += `${fi.item.wikiLink ? ` - <a href="${fi.item.wikiLink}" target="_blank" rel="noopener noreferrer">Wiki</a>` : ''}</li>`;
            itemsHtml += displayText;
        });
        itemsHtml += '</ul>';
    }

    if (missingItems.length > 0) {
        itemsHtml += (foundItems.length > 0 ? '<hr>' : '') + '<h4>Missing Items (Not Detected):</h4><ul>';
        missingItems.sort((a, b) => (a.name || "").localeCompare(b.name || ""))
            .forEach(item => {
                itemsHtml += `<li>${item.name} (ID: ${item.id || 'N/A'})` +
                             `${item.wikiLink ? ` - <a href="${item.wikiLink}" target="_blank" rel="noopener noreferrer">Wiki</a>` : ''}</li>`;
            });
        itemsHtml += '</ul>';
    }

    if (itemsHtml === '') {
        const relevantKappaItemsWithId = State.kappaRequiredItemsData.filter(item => item.id).length;
        if (State.kappaRequiredItemsData.length === 0) itemsHtml = '<p>Kappa items list not loaded or empty.</p>';
        else if (relevantKappaItemsWithId === 0) itemsHtml = '<p>No Kappa items with IDs found in the data.</p>';
        else if (Object.values(State.kappaRequiredItemIcons).filter(icon => icon !== null).length === 0 && relevantKappaItemsWithId > 0) {
            itemsHtml = '<p>No Kappa item icons were successfully loaded from local files for matching.</p>';
        }
        else itemsHtml = '<p>No items found, and no items reported as missing (check data or processing log).</p>';
    }

    const successfullyLoadedIconsCount = Object.values(State.kappaRequiredItemIcons).filter(icon => icon !== null).length;
    if (State.kappaRequiredItemsData.length > 0 && successfullyLoadedIconsCount > 0 &&
        foundItems.length === successfullyLoadedIconsCount && missingItems.length === 0 && foundItems.length > 0) {
       itemsHtml = '<h4>All required Kappa items (with successfully loaded local icons) found in the image!</h4>' + itemsHtml;
   }


    DOM.kappaDomElements.matchedItemsListDiv.innerHTML = itemsHtml;
    updateCollapsibleVisibility(
        DOM.kappaDomElements.matchedItemsHeader,
        DOM.kappaDomElements.matchedItemsContent,
        itemsHtml.length > 0,
        Config.IS_DEV_MODE
    );
}