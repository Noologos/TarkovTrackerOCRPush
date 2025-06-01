// js/kappa-worker.js
let cv = null;
let cvInitializationPromise = null;

const TARGET_1x1_SIZE = 64;
const SIZE_TOLERANCE_PERCENT_1x1 = 0.20;
const ASPECT_RATIO_TOLERANCE_1x1 = 0.20;
const FIXED_CROP_1x1_HORIZONTAL = 15;
const PERCENT_CROP_TOP_GENERAL = 0.10;
const PERCENT_CROP_HORIZONTAL_GENERAL = 0.05;
const PERCENT_CROP_AGGRESSIVE_VERTICAL_P3 = 0.25;
const PERCENT_CROP_AGGRESSIVE_HORIZONTAL_P3 = 0.25;
const MINIMAL_FALLBACK_CROP_PERCENT = 0.02;

function deleteCvMats(...mats) {
    for (const mat of mats) {
        if (mat && typeof mat.delete === 'function' && (typeof mat.isDeleted !== 'function' || !mat.isDeleted())) {
            mat.delete();
        }
    }
}

function calculateIoU(rect1, rect2) {
    if (!rect1 || !rect2) return 0;
    const xA = Math.max(rect1.left, rect2.left);
    const yA = Math.max(rect1.top, rect2.top);
    const xB = Math.min(rect1.left + rect1.width, rect2.left + rect2.width);
    const yB = Math.min(rect1.top + rect1.height, rect2.top + rect2.height);
    const intersectionArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    if (intersectionArea === 0) return 0;
    const rect1Area = rect1.width * rect1.height;
    const rect2Area = rect2.width * rect2.height;
    if (rect1Area <= 0 || rect2Area <= 0) return 0;
    return intersectionArea / (rect1Area + rect2Area - intersectionArea);
}

function checkContainment(rectA, rectB, containmentThreshold) {
    if (!rectA || !rectB) return false;
    const xA_inter = Math.max(rectA.left, rectB.left);
    const yA_inter = Math.max(rectA.top, rectB.top);
    const xB_inter = Math.min(rectA.left + rectA.width, rectB.left + rectB.width);
    const yB_inter = Math.min(rectA.top + rectA.height, rectB.top + rectB.height);
    const intersectionArea = Math.max(0, xB_inter - xA_inter) * Math.max(0, yB_inter - yA_inter);
    if (intersectionArea === 0) return false;
    const rectAArea = rectA.width * rectA.height;
    const rectBArea = rectB.width * rectB.height;
    if (rectAArea > 0 && (intersectionArea / rectAArea) >= containmentThreshold) return true;
    if (rectBArea > 0 && (intersectionArea / rectBArea) >= containmentThreshold) return true;
    return false;
}

function performNMS(candidateMatchesInput, config) {
    const { iouThreshold, containmentThreshold, nmsContextLogPrefix = "NMS", iouThresholdP3Lenient, containmentThresholdP3Lenient } = config;

    const sortedCandidates = [...candidateMatchesInput].sort((a, b) => {
        const passOrder = { 2: 1, 1: 2, 3: 3 };
        const priorityA = passOrder[a.pass] !== undefined ? passOrder[a.pass] : 99;
        const priorityB = passOrder[b.pass] !== undefined ? passOrder[b.pass] : 99;

        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        return b.confidence - a.confidence;
    });

    const keptItems = [];
    const keptItemIdsThisRun = new Set();
    const suppressedItemIdsDueToOverlap = new Set();

    for (const potentialMatch of sortedCandidates) {
        if (keptItemIdsThisRun.has(potentialMatch.item.id) || suppressedItemIdsDueToOverlap.has(potentialMatch.item.id)) {
            continue;
        }
        let isSuppressedByDifferentItem = false;
        for (const keptItem of keptItems) {
            let effectiveIouThreshold = iouThreshold;
            let effectiveContainmentThreshold = containmentThreshold;

            if (iouThresholdP3Lenient !== undefined &&
                containmentThresholdP3Lenient !== undefined &&
                potentialMatch.pass === 3) {
                effectiveIouThreshold = iouThresholdP3Lenient;
                effectiveContainmentThreshold = containmentThresholdP3Lenient;
            }

            const iou = calculateIoU(potentialMatch.location, keptItem.location);
            const contained = checkContainment(potentialMatch.location, keptItem.location, effectiveContainmentThreshold);

            if (iou > effectiveIouThreshold || contained) {
                isSuppressedByDifferentItem = true;
                suppressedItemIdsDueToOverlap.add(potentialMatch.item.id);
                self.postMessage({ type: 'debug', message: `Worker ${nmsContextLogPrefix}: Suppressed "${potentialMatch.item.name}" (P${potentialMatch.pass}, Conf: ${potentialMatch.confidence.toFixed(3)}, C:${potentialMatch.cropType || 'N/A'}) due to overlap (IoU: ${iou.toFixed(3)}>${effectiveIouThreshold.toFixed(3)}, Contained: ${contained} against thresh ${effectiveContainmentThreshold.toFixed(3)}) with "${keptItem.item.name}" (P${keptItem.pass}, Conf: ${keptItem.confidence.toFixed(3)}, C:${keptItem.cropType || 'N/A'})` });
                break;
            }
        }
        if (!isSuppressedByDifferentItem) {
            keptItems.push({ ...potentialMatch });
            keptItemIdsThisRun.add(potentialMatch.item.id);
        }
    }
    return { kept_items: keptItems, suppressed_item_ids: suppressedItemIdsDueToOverlap, kept_item_ids: keptItemIdsThisRun };
}

function initializeOpenCV(cvPath) {
    if (!cvInitializationPromise) {
        self.postMessage({ type: 'status', message: 'Worker: Initializing OpenCV from ' + cvPath });
        cvInitializationPromise = new Promise((resolve, reject) => {
            try {
                self.postMessage({ type: 'debug', message: 'Worker: Attempting importScripts: ' + cvPath });
                importScripts(cvPath);
                self.postMessage({ type: 'debug', message: 'Worker: importScripts completed.' });
                if (!self.cv) { throw new Error('self.cv is undefined after importScripts.'); }
                if (typeof self.cv.then === 'function') {
                    self.cv.then(resolve).catch(reject);
                } else if (self.cv.Mat) {
                    resolve(self.cv);
                } else {
                    throw new Error('self.cv exists but is not a promise and cv.Mat is not found.');
                }
            } catch (e) {
                const errorMsg = `Worker: Error during OpenCV init: ${e.message || e}`;
                self.postMessage({ type: 'error', message: errorMsg });
                console.error(errorMsg, e);
                reject(e);
            }
        }).then(cvInstance => {
            self.postMessage({ type: 'status', message: 'Worker: OpenCV loaded successfully.' });
            return cvInstance;
        });
    }
    return cvInitializationPromise;
}

function prepareCroppedTemplates(cvInstance, baseGrayMat, itemName, passNum, is1x1Item) {
    const results = { baseCroppedMat: null, rotatedCroppedMat: null, newMatsCreated: [] };
    if (!baseGrayMat || baseGrayMat.empty()) return results;

    const assetWidth = baseGrayMat.cols;
    const assetHeight = baseGrayMat.rows;
    let topCropPx, bottomCropPx, leftCropPx, rightCropPx;

    if (passNum === 3) {
        topCropPx = Math.floor(assetHeight * PERCENT_CROP_AGGRESSIVE_VERTICAL_P3);
        bottomCropPx = Math.floor(assetHeight * PERCENT_CROP_AGGRESSIVE_VERTICAL_P3);
        leftCropPx = Math.floor(assetWidth * PERCENT_CROP_AGGRESSIVE_HORIZONTAL_P3);
        rightCropPx = Math.floor(assetWidth * PERCENT_CROP_AGGRESSIVE_HORIZONTAL_P3);

        if (topCropPx + bottomCropPx >= assetHeight) {
            topCropPx = Math.max(0, Math.floor(assetHeight * MINIMAL_FALLBACK_CROP_PERCENT));
            bottomCropPx = Math.max(0, Math.floor(assetHeight * MINIMAL_FALLBACK_CROP_PERCENT));
        }
        if (leftCropPx + rightCropPx >= assetWidth) {
            leftCropPx = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT));
            rightCropPx = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT));
        }
    } else {
        topCropPx = Math.floor(assetHeight * PERCENT_CROP_TOP_GENERAL);
        bottomCropPx = 0;

        if (is1x1Item) {
            leftCropPx = FIXED_CROP_1x1_HORIZONTAL;
            rightCropPx = FIXED_CROP_1x1_HORIZONTAL;
            if (leftCropPx + rightCropPx >= assetWidth) {
                leftCropPx = Math.floor(assetWidth * PERCENT_CROP_HORIZONTAL_GENERAL);
                rightCropPx = Math.floor(assetWidth * PERCENT_CROP_HORIZONTAL_GENERAL);
                if (leftCropPx + rightCropPx >= assetWidth) {
                    leftCropPx = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT));
                    rightCropPx = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT));
                }
            }
        } else {
            leftCropPx = Math.floor(assetWidth * PERCENT_CROP_HORIZONTAL_GENERAL);
            rightCropPx = Math.floor(assetWidth * PERCENT_CROP_HORIZONTAL_GENERAL);
            if (leftCropPx + rightCropPx >= assetWidth) {
                leftCropPx = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT));
                rightCropPx = Math.max(0, Math.floor(assetWidth * MINIMAL_FALLBACK_CROP_PERCENT));
            }
        }
        if (topCropPx + bottomCropPx >= assetHeight) {
             topCropPx = Math.max(0, Math.floor(assetHeight * MINIMAL_FALLBACK_CROP_PERCENT));
        }
    }

    const cropX = leftCropPx;
    const cropY = topCropPx;
    const cropWidth = assetWidth - leftCropPx - rightCropPx;
    const cropHeight = assetHeight - topCropPx - bottomCropPx;

    if (cropWidth > 0 && cropHeight > 0) {
        const cropRect = new cvInstance.Rect(cropX, cropY, cropWidth, cropHeight);
        results.baseCroppedMat = baseGrayMat.roi(cropRect);

        if (results.baseCroppedMat && !results.baseCroppedMat.empty()) {
            results.rotatedCroppedMat = new cvInstance.Mat();
            cvInstance.rotate(results.baseCroppedMat, results.rotatedCroppedMat, cvInstance.ROTATE_90_CLOCKWISE);
            if (results.rotatedCroppedMat && !results.rotatedCroppedMat.empty()) {
                results.newMatsCreated.push(results.rotatedCroppedMat);
            } else {
                deleteCvMats(results.rotatedCroppedMat); results.rotatedCroppedMat = null;
            }
        } else {
            deleteCvMats(results.baseCroppedMat); results.baseCroppedMat = null;
        }
    } else {
        self.postMessage({ type: 'debug', message: `Worker: Invalid crop size for ${itemName} (Pass ${passNum}, W:${cropWidth}, H:${cropHeight}). Skipping.` });
    }
    return results;
}

function prepareUncroppedRotatedTemplate(cvInstance, baseGrayMat) {
    const results = { rotatedUncroppedMat: null, newMatsCreated: [] };
    if (!baseGrayMat || baseGrayMat.empty()) return results;
    results.rotatedUncroppedMat = new cvInstance.Mat();
    cvInstance.rotate(baseGrayMat, results.rotatedUncroppedMat, cvInstance.ROTATE_90_CLOCKWISE);
    if (results.rotatedUncroppedMat && !results.rotatedUncroppedMat.empty()) {
        results.newMatsCreated.push(results.rotatedUncroppedMat);
    } else {
        deleteCvMats(results.rotatedUncroppedMat); results.rotatedUncroppedMat = null;
    }
    return results;
}

function executeTemplateMatching(cvInstance, srcGray, item, templateMat, rotation, cropType, scales, passNum, workerConfig, isPass1Mode) {
    const results = {
        foundMatches: [],
        bestConfidenceThisTemplate: 0,
        scaleOfBestConfidenceThisTemplate: null,
        earlyExitTriggered: false,
        scaleOfEarlyExit: null
    };
    if (!templateMat || templateMat.empty()) return results;

    const collectionConfidenceThreshold = isPass1Mode ?
        (workerConfig.KAPPA_MATCH_CONFIDENCE_THRESHOLD - 0.15) :
        workerConfig.KAPPA_MATCH_CONFIDENCE_THRESHOLD;

    for (const scale of scales) {
        let templScaled = null, dst = null, mask = null;
        try {
            const dsize = new cvInstance.Size(Math.round(templateMat.cols * scale), Math.round(templateMat.rows * scale));
            if (dsize.width < 1 || dsize.height < 1 || dsize.width > srcGray.cols || dsize.height > srcGray.rows) continue;

            templScaled = new cvInstance.Mat();
            cvInstance.resize(templateMat, templScaled, dsize, 0, 0, cvInstance.INTER_AREA);
            if (templScaled.empty() || cvInstance.minMaxLoc(templScaled).minVal === cvInstance.minMaxLoc(templScaled).maxVal) continue;

            dst = new cvInstance.Mat(); mask = new cvInstance.Mat();
            cvInstance.matchTemplate(srcGray, templScaled, dst, cvInstance.TM_CCOEFF_NORMED, mask);
            const { maxVal, maxLoc } = cvInstance.minMaxLoc(dst, mask);

            if (maxVal > collectionConfidenceThreshold) {
                results.foundMatches.push({
                    item: { id: item.id, name: item.name, shortName: item.shortName, wikiLink: item.wikiLink },
                    confidence: maxVal,
                    location: { left: maxLoc.x, top: maxLoc.y, width: templScaled.cols, height: templScaled.rows },
                    rotation: rotation, scale: scale, pass: passNum, cropType: cropType
                });
            }
            if (isPass1Mode) {
                if (maxVal > results.bestConfidenceThisTemplate) {
                    results.bestConfidenceThisTemplate = maxVal;
                    results.scaleOfBestConfidenceThisTemplate = scale;
                }
                if (maxVal > workerConfig.KAPPA_PASS1_EARLY_EXIT_CONFIDENCE_THRESHOLD) {
                    results.earlyExitTriggered = true; results.scaleOfEarlyExit = scale;
                }
            }
        } catch (e) {
            self.postMessage({type:'debug', message: `TM Error: ${item.name} S:${scale.toFixed(2)} R:${rotation} C:${cropType} P:${passNum} - ${e.message}`});
        } finally {
            deleteCvMats(dst, mask, templScaled);
        }
        if (isPass1Mode && results.earlyExitTriggered) break;
    }
    return results;
}

function processSingleItem(context) {
    const { cvInst, srcGray, item, iconImageDataMap, scales, passNum, workerConfig, isPass1Mode, templateConfigs } = context;
    const aggregatedResults = {
        foundMatches: [],
        bestConfidenceThisTemplate: 0,
        scaleOfBestConfidenceThisTemplate: null,
        earlyExitTriggered: false,
        scaleOfEarlyExit: null
    };

    const iconImgData = iconImageDataMap[item.id];
    if (!iconImgData || !iconImgData.data || iconImgData.width === 0 || iconImgData.height === 0) {
        return aggregatedResults;
    }

    let templFullRGBA = null, templFullGrayUncropped = null;
    const itemSpecificMatsToClean = [];

    try {
        templFullRGBA = cvInst.matFromImageData(iconImgData);
        if (templFullRGBA.empty()) return aggregatedResults;
        templFullGrayUncropped = new cvInst.Mat();
        cvInst.cvtColor(templFullRGBA, templFullGrayUncropped, cvInst.COLOR_RGBA2GRAY);
        if (templFullGrayUncropped.empty()) return aggregatedResults;

        for (const config of templateConfigs) {
            let templateToMatch = null;
            let prepResults = null;

            if (config.type === "cropped") {
                prepResults = prepareCroppedTemplates(cvInst, templFullGrayUncropped, item.name, passNum, item.is1x1Item);
                if (prepResults.baseCroppedMat) itemSpecificMatsToClean.push(prepResults.baseCroppedMat);
                itemSpecificMatsToClean.push(...prepResults.newMatsCreated);
                templateToMatch = config.rotation === 0 ? prepResults.baseCroppedMat : prepResults.rotatedCroppedMat;
            } else if (config.type === "uncropped") {
                if (config.rotation === 0) {
                    templateToMatch = templFullGrayUncropped;
                } else {
                    prepResults = prepareUncroppedRotatedTemplate(cvInst, templFullGrayUncropped);
                    itemSpecificMatsToClean.push(...prepResults.newMatsCreated);
                    templateToMatch = prepResults.rotatedUncroppedMat;
                }
            }

            if (templateToMatch && !templateToMatch.empty()) {
                const matchRunResult = executeTemplateMatching(cvInst, srcGray, item, templateToMatch, config.rotation, config.type, scales, passNum, workerConfig, isPass1Mode);
                aggregatedResults.foundMatches.push(...matchRunResult.foundMatches);

                if (isPass1Mode) {
                    if (matchRunResult.bestConfidenceThisTemplate > aggregatedResults.bestConfidenceThisTemplate) {
                        aggregatedResults.bestConfidenceThisTemplate = matchRunResult.bestConfidenceThisTemplate;
                        aggregatedResults.scaleOfBestConfidenceThisTemplate = matchRunResult.scaleOfBestConfidenceThisTemplate;
                    }
                    if (matchRunResult.earlyExitTriggered) {
                        aggregatedResults.earlyExitTriggered = true;
                        aggregatedResults.scaleOfEarlyExit = matchRunResult.scaleOfEarlyExit;
                        if (matchRunResult.bestConfidenceThisTemplate > aggregatedResults.bestConfidenceThisTemplate) {
                           aggregatedResults.bestConfidenceThisTemplate = matchRunResult.bestConfidenceThisTemplate;
                           aggregatedResults.scaleOfBestConfidenceThisTemplate = matchRunResult.scaleOfBestConfidenceThisTemplate;
                        }
                        break;
                    }
                }
            }
        }
    } catch (e) {
        self.postMessage({ type: 'error', message: `Error processing item ${item.name} in P${passNum}: ${e.message}` });
    } finally {
        deleteCvMats(templFullRGBA, templFullGrayUncropped, ...itemSpecificMatsToClean);
    }
    return aggregatedResults;
}

function getBestMatches(matches) {
    const bestMap = new Map();
    for (const match of matches) {
        if (!bestMap.has(match.item.id) || match.confidence > bestMap.get(match.item.id).confidence) {
            bestMap.set(match.item.id, match);
        }
    }
    return Array.from(bestMap.values());
}


self.addEventListener('message', async (event) => {
    const { imageData, kappaRequiredItemsData, iconImageDataMap, config, cvPath } = event.data;
    const workerConfig = config;
    const broadScales = [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0];

    if (!cv) {
        try {
            cv = await initializeOpenCV(cvPath);
            if (!cv) { self.postMessage({ type: 'error', message: 'Worker: OpenCV could not be initialized.' }); return; }
        } catch (cvError) { self.postMessage({ type: 'error', message: `Worker: Failed to initialize OpenCV - ${cvError.message || cvError}` }); return; }
    }

    kappaRequiredItemsData.forEach(item => {
        const icon = iconImageDataMap[item.id];
        if (icon && icon.width > 0 && icon.height > 0) {
            const aspectRatio = icon.width / icon.height;
            const avgDim = (icon.width + icon.height) / 2;
            item.is1x1Item = aspectRatio >= (1 - ASPECT_RATIO_TOLERANCE_1x1) && aspectRatio <= (1 + ASPECT_RATIO_TOLERANCE_1x1) &&
                             avgDim >= TARGET_1x1_SIZE * (1 - SIZE_TOLERANCE_PERCENT_1x1) && avgDim <= TARGET_1x1_SIZE * (1 + SIZE_TOLERANCE_PERCENT_1x1);
        } else {
            item.is1x1Item = false;
        }
    });

    let srcGray = null;
    try {
        const mainImageMatRGBA = cv.matFromImageData(imageData);
        srcGray = new cv.Mat();
        cv.cvtColor(mainImageMatRGBA, srcGray, cv.COLOR_RGBA2GRAY);
        deleteCvMats(mainImageMatRGBA);
    } catch (e) {
        self.postMessage({ type: 'error', message: `Worker: Error processing main image: ${e.message}` });
        deleteCvMats(srcGray); return;
    }

    let bestOverallScale = 1.0;
    let pass1HighestOverallConfidence = 0;
    let pass1RawPotentialMatches = [];
    let pass1EarlyExitTriggered = false;

    const p1TemplateConfigs = [{ type: 'cropped', rotation: 0 }, { type: 'cropped', rotation: 90 }];
    for (let i = 0; i < kappaRequiredItemsData.length; i++) {
        const item = kappaRequiredItemsData[i];
        if (pass1EarlyExitTriggered) break;
        self.postMessage({ type: 'progress', phase: 1, processed: i + 1, total: kappaRequiredItemsData.length, itemName: item.name });

        const itemResultP1 = processSingleItem({ cvInst: cv, srcGray, item, iconImageDataMap, scales: broadScales, passNum: 1, workerConfig, isPass1Mode: true, templateConfigs: p1TemplateConfigs });
        pass1RawPotentialMatches.push(...itemResultP1.foundMatches);

        if (itemResultP1.bestConfidenceThisTemplate > pass1HighestOverallConfidence) {
            pass1HighestOverallConfidence = itemResultP1.bestConfidenceThisTemplate;
            if (pass1HighestOverallConfidence > workerConfig.KAPPA_PASS1_SCALE_CONFIDENCE_THRESHOLD && itemResultP1.scaleOfBestConfidenceThisTemplate) {
                bestOverallScale = itemResultP1.scaleOfBestConfidenceThisTemplate;
            }
        }
        if (itemResultP1.earlyExitTriggered) {
            if (itemResultP1.scaleOfEarlyExit) bestOverallScale = itemResultP1.scaleOfEarlyExit;
            pass1HighestOverallConfidence = itemResultP1.bestConfidenceThisTemplate;
            pass1EarlyExitTriggered = true;
        }
    }
    const pass1FilteredPotentialMatches = pass1RawPotentialMatches.filter(m => m.confidence > workerConfig.KAPPA_MATCH_CONFIDENCE_THRESHOLD);

    if (!pass1EarlyExitTriggered && pass1HighestOverallConfidence < workerConfig.KAPPA_PASS1_SCALE_CONFIDENCE_THRESHOLD) {
        bestOverallScale = 1.0;
    }

    const targetedScales = [bestOverallScale * 0.98, bestOverallScale, bestOverallScale * 1.02].filter(s => s > 0.1 && s < 3.0);
    if (targetedScales.length === 0) {
        targetedScales.push(1.0);
    }

    let allPotentialMatchesPass2 = [];
    const p2TemplateConfigs = [{ type: 'cropped', rotation: 0 }, { type: 'cropped', rotation: 90 }];
    for (let i = 0; i < kappaRequiredItemsData.length; i++) {
        const item = kappaRequiredItemsData[i];
        self.postMessage({ type: 'progress', phase: 2, processed: i + 1, total: kappaRequiredItemsData.length, itemName: item.name });
        const itemResultP2 = processSingleItem({ cvInst: cv, srcGray, item, iconImageDataMap, scales: targetedScales, passNum: 2, workerConfig, isPass1Mode: false, templateConfigs: p2TemplateConfigs });
        allPotentialMatchesPass2.push(...itemResultP2.foundMatches);
    }

    let p1p2CandidatesForNMS = [];
    const p1p2CandidateItemIds = new Set();

    const bestP2ForItem = getBestMatches(allPotentialMatchesPass2);
    for (const match of bestP2ForItem) {
        p1p2CandidatesForNMS.push(match);
        p1p2CandidateItemIds.add(match.item.id);
    }

    const p1MatchesForUnfoundItems = pass1FilteredPotentialMatches.filter(m => !p1p2CandidateItemIds.has(m.item.id));
    const bestP1ForRemainingItems = getBestMatches(p1MatchesForUnfoundItems);
    for (const match of bestP1ForRemainingItems) {
        p1p2CandidatesForNMS.push(match);
    }

    const initialNMSConfig = {
        iouThreshold: workerConfig.KAPPA_NMS_IOU_THRESHOLD,
        containmentThreshold: workerConfig.KAPPA_NMS_CONTAINMENT_THRESHOLD,
        nmsContextLogPrefix: "Initial P1/P2 NMS"
    };
    const initialNMSResult = performNMS(p1p2CandidatesForNMS, initialNMSConfig);

    const protectedP1P2Items = [...initialNMSResult.kept_items];
    const protectedP1P2ItemIds = new Set(initialNMSResult.kept_item_ids);

    const itemsToRescanP3 = kappaRequiredItemsData.filter(item => item.id && !protectedP1P2ItemIds.has(item.id));
    let allPotentialMatchesPass3 = [];
    if (itemsToRescanP3.length > 0) {
        const p3TemplateConfigs = [
            { type: 'cropped', rotation: 0 }, { type: 'cropped', rotation: 90 },
            { type: 'uncropped', rotation: 0 }, { type: 'uncropped', rotation: 90 }
        ];
        for (let i = 0; i < itemsToRescanP3.length; i++) {
            const item = itemsToRescanP3[i];
            self.postMessage({ type: 'progress', phase: 3, processed: i + 1, total: itemsToRescanP3.length, itemName: item.name });
            const itemResultP3 = processSingleItem({ cvInst: cv, srcGray, item, iconImageDataMap, scales: broadScales, passNum: 3, workerConfig, isPass1Mode: false, templateConfigs: p3TemplateConfigs });
            allPotentialMatchesPass3.push(...itemResultP3.foundMatches);
        }
    }

    const p3CandidatesRaw = allPotentialMatchesPass3.filter(m => !protectedP1P2ItemIds.has(m.item.id));
    const bestP3CandidatesAlone = getBestMatches(p3CandidatesRaw);

    const nmsAmongP3Config = {
        iouThreshold: workerConfig.KAPPA_NMS_IOU_THRESHOLD_P3_LENIENT,
        containmentThreshold: workerConfig.KAPPA_NMS_CONTAINMENT_THRESHOLD_P3_LENIENT,
        nmsContextLogPrefix: "P3-vs-P3 NMS",
        iouThresholdP3Lenient: workerConfig.KAPPA_NMS_IOU_THRESHOLD_P3_LENIENT,
        containmentThresholdP3Lenient: workerConfig.KAPPA_NMS_CONTAINMENT_THRESHOLD_P3_LENIENT
    };
    const p3NMSResult = performNMS(bestP3CandidatesAlone, nmsAmongP3Config);
    const nonOverlappingP3Items = p3NMSResult.kept_items;

    let finalMergedItems = [...protectedP1P2Items];
    const finalMergedItemIds = new Set(protectedP1P2ItemIds);

    for (const p3Item of nonOverlappingP3Items) {
        if (finalMergedItemIds.has(p3Item.item.id)) continue;

        let canAddP3Item = true;
        for (const protectedItem of protectedP1P2Items) {
            const iou = calculateIoU(p3Item.location, protectedItem.location);
            const contained = checkContainment(p3Item.location, protectedItem.location, workerConfig.KAPPA_NMS_CONTAINMENT_THRESHOLD);

            if (iou > workerConfig.KAPPA_NMS_IOU_THRESHOLD || contained) {
                canAddP3Item = false;
                self.postMessage({ type: 'debug', message: `Worker FinalMerge: P3 item "${p3Item.item.name}" (P${p3Item.pass}, Conf: ${p3Item.confidence.toFixed(3)}) conflicts with protected item "${protectedItem.item.name}" (P${protectedItem.pass}, Conf: ${protectedItem.confidence.toFixed(3)}). P3 item NOT added due to strict P1/P2 NMS rules.` });
                break;
            }
        }
        if (canAddP3Item) {
            finalMergedItems.push(p3Item);
            finalMergedItemIds.add(p3Item.item.id);
        }
    }

    finalMergedItems.sort((a,b) => b.confidence - a.confidence);

    const finalFoundItems = finalMergedItems;
    const finalFoundItemIds = new Set(finalFoundItems.map(item => item.item.id));


    let missingItems = kappaRequiredItemsData
        .filter(item => item.id && !finalFoundItemIds.has(item.id))
        .map(item => ({ id: item.id, name: item.name, shortName: item.shortName, wikiLink: item.wikiLink, reason: "Not detected or suppressed" }));

    self.postMessage({ type: 'result', foundItems: finalFoundItems, missingItems: missingItems });
    self.postMessage({ type: 'status', message: 'Worker: Processing complete.' });

    deleteCvMats(srcGray);
});