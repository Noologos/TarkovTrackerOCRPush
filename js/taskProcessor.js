// js/taskProcessor.js
/* global cv, Tesseract, Fuse */
import * as State from './state.js';
import * as Config from './config.js';
import * as Utils from './utils.js';
import {
    reportTaskStatus, reportTaskOutput,
    updateCollapsibleVisibility, updateMainAndDebugCanvasesDisplay,
    drawTaskImageOnCanvas,
} from './ui.js';
import { updateButtonStates } from './main.js';

function getPrerequisiteTaskIds(activeTaskIds, currentTaskTree) {
    const prerequisiteIds = new Set();
    const visitedForTraversal = new Set();

    function findPrerequisitesRecursive(currentTaskId) {
        if (visitedForTraversal.has(currentTaskId)) return;
        visitedForTraversal.add(currentTaskId);

        const task = currentTaskTree[currentTaskId];
        if (!task) return;

        task.taskRequirements?.forEach(req => {
            if (req.task?.id && currentTaskTree[req.task.id]) {
                prerequisiteIds.add(req.task.id);
                findPrerequisitesRecursive(req.task.id);
            }
        });
    }
    Array.from(activeTaskIds).forEach(activeTaskId => {
        visitedForTraversal.clear();
        findPrerequisitesRecursive(activeTaskId);
    });
    return Array.from(prerequisiteIds);
}

function matchOcrLineToTask(ocrLine, allTarkovTasksData, traderName) {
    const cleanedOcrLine = Utils.cleanStringForMatching(ocrLine);
    if (cleanedOcrLine.length === 0 || !State.fuse) return null;

    const relevantTasks = allTarkovTasksData.filter(task =>
        task.trader && Utils.cleanStringForMatching(task.trader.name) === Utils.cleanStringForMatching(traderName)
    );

    if (relevantTasks.length === 0) return null;

    const traderFuse = new Fuse(relevantTasks, {
        keys: ['name'],
        includeScore: true,
        threshold: Config.FUSE_THRESHOLD,
        ignoreLocation: true,
        distance: 100,
        isCaseSensitive: false,
        findAllMatches: false,
        minMatchCharLength: 3
    });

    const result = traderFuse.search(cleanedOcrLine);
    return (result.length > 0 && result[0].score <= Config.FUSE_THRESHOLD) ? result[0] : null;
}


export async function processSingleTask(taskName) {
    const task = State.getTask(taskName);
    if (!task) {
        console.error(`Task object for ${taskName} not found.`);
        return;
    }

    if (!task.processingResults) {
        State.updateTaskProcessingResults(taskName, State.createInitialTaskProcessingResults());
    } else {
        State.resetTaskIdentifiedCompletedIds(taskName);
        State.setTaskRequiredToPost(taskName, []);
    }


    const { image, domElements, processingResults } = task;
    const { originalCanvas, processedCanvas, outputHeader, outputContent, wikiHeader, wikiContent, requiredTasksHeader, requiredTasksContent } = domElements;

    reportTaskOutput(taskName, "");
    updateCollapsibleVisibility(outputHeader, outputContent, false);
    updateCollapsibleVisibility(wikiHeader, wikiContent, false);
    updateCollapsibleVisibility(requiredTasksHeader, requiredTasksContent, false);
    if (domElements.wikiLinksDiv) domElements.wikiLinksDiv.innerHTML = '';
    if (domElements.requiredTasksDiv) domElements.requiredTasksDiv.innerHTML = '';


    if (!image) {
        reportTaskStatus(taskName, taskName !== "Ref" ? 'No image uploaded. Skipping.' : 'No Ref image provided.');
        if (taskName === "Ref") reportTaskOutput(taskName, 'No Ref image provided.');
        updateButtonStates();
        return;
    }

    reportTaskStatus(taskName, `Processing ${taskName}...`);

    try {
        if (typeof cv === 'undefined' || typeof cv.imread !== 'function') {
            throw new Error("OpenCV (cv) is not loaded or not ready.");
        }
        if (!State.discriminantImage1 || !State.discriminantImage2) {
            throw new Error("Discriminant images not loaded.");
        }

        let src = cv.imread(image);
        let templ1 = cv.imread(State.discriminantImage1);
        let templ2 = cv.imread(State.discriminantImage2);
        let dst1 = new cv.Mat();
        let dst2 = new cv.Mat();
        let mask = new cv.Mat();
        let srcRoi = null;

        try {
            if (src.channels() > 1) cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
            if (templ1.channels() > 1) cv.cvtColor(templ1, templ1, cv.COLOR_RGBA2GRAY, 0);
            if (templ2.channels() > 1) cv.cvtColor(templ2, templ2, cv.COLOR_RGBA2GRAY, 0);

            const searchRect = new cv.Rect(0, 0, Math.floor(image.naturalWidth / 2), image.naturalHeight);
            searchRect.width = Math.max(0, Math.min(searchRect.width, src.cols - Math.max(templ1.cols, templ2.cols)));
            searchRect.height = Math.max(0, Math.min(searchRect.height, src.rows - Math.max(templ1.rows, templ2.rows)));

            if (searchRect.width > 0 && searchRect.height > 0 &&
                searchRect.width >= Math.max(templ1.cols, templ2.cols) &&
                searchRect.height >= Math.max(templ1.rows, templ2.rows)) {
                srcRoi = src.roi(searchRect);
            } else {
                throw new Error('Search area for discriminants is invalid or too small for templates.');
            }

            cv.matchTemplate(srcRoi, templ1, dst1, cv.TM_CCOEFF_NORMED, mask);
            const { maxVal: maxVal1, maxLoc: matchLoc1 } = cv.minMaxLoc(dst1, mask);

            cv.matchTemplate(srcRoi, templ2, dst2, cv.TM_CCOEFF_NORMED, mask);
            const { maxVal: maxVal2, maxLoc: matchLoc2 } = cv.minMaxLoc(dst2, mask);

            processingResults.discriminant1Rect = null;
            processingResults.discriminant2Rect = null;
            processingResults.ocrRect = null;

            const DISCRIMINANT_CONF_THRESHOLD = 0.7;
            if (maxVal1 > DISCRIMINANT_CONF_THRESHOLD) {
                processingResults.discriminant1Rect = {
                    left: matchLoc1.x + searchRect.x, top: matchLoc1.y + searchRect.y,
                    width: State.discriminantImage1.naturalWidth, height: State.discriminantImage1.naturalHeight
                };
            }
            if (maxVal2 > DISCRIMINANT_CONF_THRESHOLD) {
                processingResults.discriminant2Rect = {
                    left: matchLoc2.x + searchRect.x, top: matchLoc2.y + searchRect.y,
                    width: State.discriminantImage2.naturalWidth, height: State.discriminantImage2.naturalHeight
                };
            }
        } finally {
            Utils.deleteCvMats(src, templ1, templ2, dst1, dst2, mask, srcRoi);
        }

        [processingResults.discriminant1Rect, processingResults.discriminant2Rect].forEach(r => {
            if (r) {
                r.left = Math.max(0, r.left); r.top = Math.max(0, r.top);
                r.width = Math.max(0, Math.min(r.width, image.naturalWidth - r.left));
                r.height = Math.max(0, Math.min(r.height, image.naturalHeight - r.top));
            }
        });


        if (processingResults.discriminant1Rect || processingResults.discriminant2Rect) {
            const d1 = processingResults.discriminant1Rect;
            const d2 = processingResults.discriminant2Rect;

            const lmD = (d1 && d2) ? (d1.left < d2.left ? d1 : d2) : (d1 || d2);
            const rmD = (d1 && d2) ? (d1.left >= d2.left ? d1 : d2) : (d1 || d2);
            const lwD = (d1 && d2) ? (d1.top > d2.top ? d1 : d2) : (d1 || d2);

            const ocrBottomLimit = image.naturalHeight * Config.OCR_BOTTOM_PERCENTAGE;

            processingResults.ocrRect = {
                left: lmD.left + lmD.width,
                top: lwD.top,
                width: rmD.left - (lmD.left + lmD.width),
                height: ocrBottomLimit - lwD.top
            };

            const r = processingResults.ocrRect;
            r.left = Math.max(0, Math.min(r.left, image.naturalWidth));
            r.top = Math.max(0, Math.min(r.top, image.naturalHeight));
            r.width = Math.max(0, Math.min(r.width, image.naturalWidth - r.left));
            r.height = Math.max(0, Math.min(r.height, image.naturalHeight - r.top, ocrBottomLimit - r.top));

            drawTaskImageOnCanvas(taskName);

            if (r.width > 0 && r.height > 0) {
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = r.width;
                tempCanvas.height = r.height;
                const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
                tempCtx.drawImage(image, r.left, r.top, r.width, r.height, 0, 0, tempCanvas.width, tempCanvas.height);

                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const { data: pixels, width: ocrW, height: ocrH } = imageData;

                let currentBlockStartRow = 0;
                let previousLeftmostBrightness = -1;

                for (let y = 0; y < ocrH; y++) {
                    const i = (y * ocrW) * 4;
                    const currentLeftmostBrightness = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;

                    if (previousLeftmostBrightness === -1) {
                        previousLeftmostBrightness = currentLeftmostBrightness;
                    }

                    if (Math.abs(currentLeftmostBrightness - previousLeftmostBrightness) > Config.BRIGHTNESS_CHANGE_THRESHOLD || y === ocrH - 1) {
                        const blockEndRow = (y === ocrH - 1) ? y : y - 1;
                        const blockHeight = blockEndRow - currentBlockStartRow + 1;

                        if (blockHeight > 0) {
                            let blockTotalBrightness = 0;
                            let blockPixelCount = 0;
                            for (let by = currentBlockStartRow; by <= blockEndRow; by++) {
                                for (let x = 0; x < ocrW; x++) {
                                    const pi = (by * ocrW + x) * 4;
                                    blockTotalBrightness += (pixels[pi] + pixels[pi + 1] + pixels[pi + 2]) / 3;
                                    blockPixelCount++;
                                }
                            }

                            const avgBlockBrightness = blockPixelCount > 0 ? blockTotalBrightness / blockPixelCount : 128;
                            const shouldInvert = (255 - avgBlockBrightness) > avgBlockBrightness;

                            for (let by = currentBlockStartRow; by <= blockEndRow; by++) {
                                for (let x = 0; x < ocrW; x++) {
                                    const pi = (by * ocrW + x) * 4;
                                    let R = pixels[pi], G = pixels[pi + 1], B = pixels[pi + 2];
                                    if (shouldInvert) { R = 255 - R; G = 255 - G; B = 255 - B; }
                                    const gray = (R + G + B) / 3;
                                    pixels[pi] = pixels[pi + 1] = pixels[pi + 2] = (gray < Config.BINARIZATION_THRESHOLD ? 0 : 255);
                                }
                            }
                        }
                        currentBlockStartRow = y;
                        previousLeftmostBrightness = currentLeftmostBrightness;
                    }
                }
                tempCtx.putImageData(imageData, 0, 0);

                if (processedCanvas && domElements.processedCtx && Config.IS_DEV_MODE) {
                    processedCanvas.width = tempCanvas.width;
                    processedCanvas.height = tempCanvas.height;
                    domElements.processedCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
                    domElements.processedCtx.drawImage(tempCanvas, 0, 0);
                }
                updateMainAndDebugCanvasesDisplay(originalCanvas, processedCanvas, true);

                reportTaskStatus(taskName, `OCR ${taskName}: Starting...`);
                const tesseractWorker = await Utils.createTesseractWorker('eng', 1, m => {
                     reportTaskStatus(taskName, `OCR ${taskName}: ${m.status === 'recognizing text' ? `${Math.round(m.progress * 100)}%` : m.status}`);
                });
                await tesseractWorker.setParameters({
                    tessedit_char_whitelist: ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-\'',
                    tessedit_pageseg_mode: Tesseract.PSM.AUTO,
                });

                const { data: { text: ocrResultText } } = await tesseractWorker.recognize(tempCanvas);
                await tesseractWorker.terminate();

                let extractedLines = ocrResultText.split('\n')
                    .map(l => l.replace(/\bactive\b[^a-zA-Z0-9]*/gi, '').trim())
                    .filter(l => l.length > 0);

                ["activel", "active!", "activet", "active ", "active:", "ctive"].forEach(sub => {
                    extractedLines = extractedLines.map(l => l.replace(new RegExp(sub, 'gi'), '').trim()).filter(l => l.length > 0);
                });

                const matchedResults = [];
                processingResults.identifiedCompletedTaskIds.clear();

                extractedLines.forEach(line => {
                    const matchedTaskResult = matchOcrLineToTask(line, State.tarkovTasksData, taskName);
                    if (matchedTaskResult) {
                        matchedResults.push({ ocrLine: line, task: matchedTaskResult.item, score: matchedTaskResult.score });
                        State.addTaskIdentifiedCompletedId(taskName, matchedTaskResult.item.id);
                    } else if (Config.IS_DEV_MODE) {
                        matchedResults.push({ ocrLine: line, task: null, score: null });
                    }
                });

                let outputText = Config.IS_DEV_MODE ? '--- OCR Line Matches (Dev Mode) ---\n' : '--- Matched Tasks ---\n';
                const displayResults = Config.IS_DEV_MODE ? matchedResults : matchedResults.filter(r => r.task);

                if (displayResults.length > 0) {
                    displayResults.forEach(r => {
                        outputText += `"${r.ocrLine}" ${r.task ? `=> "${r.task.name}" (Fuse: ${r.score.toFixed(4)})` : '=> No Match'}\n`;
                    });
                } else {
                    outputText += Config.IS_DEV_MODE ? 'No OCR lines extracted or matched.' : 'No tasks matched for this trader.';
                }
                reportTaskOutput(taskName, outputText);

                const wikiLinksHtml = matchedResults
                    .filter(r => r.task?.wikiLink)
                    .map(r => `<li><a href="${r.task.wikiLink}" target="_blank" rel="noopener noreferrer">${r.task.name} Wiki</a></li>`)
                    .join('');
                if (domElements.wikiLinksDiv && wikiLinksHtml) {
                    domElements.wikiLinksDiv.innerHTML = `<ul>${wikiLinksHtml}</ul>`;
                }

                const prerequisiteTaskIds = getPrerequisiteTaskIds(processingResults.identifiedCompletedTaskIds, State.taskTree);
                State.setTaskRequiredToPost(taskName, prerequisiteTaskIds);

                const reqTaskObjects = prerequisiteTaskIds
                    .map(id => State.taskTree[id])
                    .filter(Boolean)
                    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

                let reqTasksHtml = '';
                if (reqTaskObjects.length > 0) {
                    reqTasksHtml = '<ul>' + reqTaskObjects.map(t =>
                        `<li>${t.name} (ID: ${t.id})${t.wikiLink ? ` - <a href="${t.wikiLink}" target="_blank" rel="noopener noreferrer">Wiki</a>` : ''}</li>`
                    ).join('') + '</ul>';
                } else {
                    reqTasksHtml = '<p>No specific prerequisite tasks identified.</p>';
                }
                if (domElements.requiredTasksDiv) domElements.requiredTasksDiv.innerHTML = reqTasksHtml;


                updateCollapsibleVisibility(outputHeader, outputContent, outputText.trim().length > 0, Config.IS_DEV_MODE);
                updateCollapsibleVisibility(wikiHeader, wikiContent, wikiLinksHtml.trim().length > 0, Config.IS_DEV_MODE);
                updateCollapsibleVisibility(requiredTasksHeader, requiredTasksContent, reqTaskObjects.length > 0, Config.IS_DEV_MODE);

                reportTaskStatus(taskName, `Processing complete for ${taskName}.`);

            } else {
                updateMainAndDebugCanvasesDisplay(originalCanvas, processedCanvas, true);
                throw new Error('Calculated OCR region is invalid (zero width or height).');
            }
        } else {
            updateMainAndDebugCanvasesDisplay(originalCanvas, processedCanvas, true);
            throw new Error('Discriminant shapes not found. Cannot define OCR region.');
        }
    } catch (error) {
        console.error(`Error processing task ${taskName}:`, error);
        reportTaskStatus(taskName, `Error: ${error.message}`);
        reportTaskOutput(taskName, `Error during processing: ${error.message}\nCheck console for more details.`);
        drawTaskImageOnCanvas(taskName);
        updateMainAndDebugCanvasesDisplay(domElements.originalCanvas, domElements.processedCanvas, !!task.image);
        updateCollapsibleVisibility(outputHeader, outputContent, true, Config.IS_DEV_MODE);
    } finally {
        updateButtonStates();
    }
}