// js/imageUtils.js

/**
 * Loads an image from a File object.
 * @param {File} file - The image file.
 * @param {function(HTMLImageElement)} callback - Called with the loaded Image object.
 */
export function loadImageFile(file, callback) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => callback(img);
        img.onerror = () => {
            console.error(`Error loading image file: ${file.name}`);
            // Optionally, call callback with null or an error indicator
            // callback(null, new Error(`Error loading image file: ${file.name}`));
        };
        if (e.target?.result) {
            img.src = e.target.result;
        } else {
            console.error("FileReader result is null for file:", file.name);
        }
    };
    reader.onerror = (e) => {
        console.error(`FileReader error for file ${file.name}:`, e);
        // Optionally, handle FileReader errors more gracefully
    };
    reader.readAsDataURL(file);
}

/**
 * Loads an image from a URL.
 * @param {string} url - The URL of the image.
 * @param {function(HTMLImageElement)} callback - Called with the loaded Image object.
 * @param {function(Event|string)} errorCallback - Called on loading error.
 */
export function loadImageFromUrl(url, callback, errorCallback) {
    const img = new Image();
    img.onload = () => callback(img);
    img.onerror = (e) => {
        console.error(`Error loading image from URL: ${url}`, e);
        if (errorCallback) errorCallback(e);
    };
    img.src = url;
}

/**
 * Draws a rectangle on a canvas context.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @param {object} rect - Rectangle object {x/left, y/top, width, height}.
 * @param {string} color - Stroke color.
 * @param {number} lineWidth - Line width.
 */
export function drawRect(ctx, rect, color, lineWidth) {
     if (!ctx || !rect) return;
     ctx.strokeStyle = color;
     ctx.lineWidth = lineWidth;
     ctx.setLineDash([]); // Ensure solid line

     const x = Number.isFinite(rect.x) ? rect.x : (Number.isFinite(rect.left) ? rect.left : 0);
     const y = Number.isFinite(rect.y) ? rect.y : (Number.isFinite(rect.top) ? rect.top : 0);
     const w = Number.isFinite(rect.width) ? rect.width : 0;
     const h = Number.isFinite(rect.height) ? rect.height : 0;

     if (w > 0 && h > 0) {
        ctx.strokeRect(x, y, w, h);
     }
}