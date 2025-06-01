// js/utils.js
import { API_KEY_STORAGE_KEY } from './config.js';

export function saveApiKey(key) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key || '');
}
export function loadApiKey() {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function cleanStringForMatching(str) {
    if (typeof str !== 'string') return '';
    return str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
}

export function createElementFromHTML(htmlString) {
    const div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstChild;
}

/**
 * Safely deletes OpenCV Mats.
 * @param  {...any} mats OpenCV Mat objects to delete.
 */
export function deleteCvMats(...mats) {
    for (const mat of mats) {
        if (mat && typeof mat.delete === 'function') {
            if (typeof mat.isDeleted !== 'function' || !mat.isDeleted()) {
                mat.delete();
            }
        }
    }
}

/**
 * Promisified Tesseract worker creation for cleaner async usage.
 * @param {string} lang Language for OCR.
 * @param {object} loggerOptions Options for Tesseract logger.
 * @returns {Promise<Tesseract.Worker>}
 */
export async function createTesseractWorker(lang = 'eng', oem = 1, loggerCallback) {
    const worker = await Tesseract.createWorker(lang, oem, {
        logger: loggerCallback ? m => loggerCallback(m) : undefined,
    });
    return worker;
}