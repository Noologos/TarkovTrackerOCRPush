// js/config.js
export const IS_DEV_MODE = false;
export const BRIGHTNESS_CHANGE_THRESHOLD = 20;
export const BINARIZATION_THRESHOLD = 120;
export const OCR_BOTTOM_PERCENTAGE = 0.9;
export const FUSE_THRESHOLD = 0.4;
export const API_KEY_STORAGE_KEY = 'tarkov_tracker_api_key';
export const KAPPA_TASK_ID = "5c51aac186f77432ea65c552";

export const DISCRIMINANT_IMAGE_PATHS = ['assets/discriminant.png', 'assets/discriminant2.png'];

export const TRADER_NAMES = ["Prapor", "Therapist", "Skier", "Peacekeeper", "Mechanic", "Ragman", "Jaeger", "Ref"];

// Kappa Processing Config

export const KAPPA_PASS1_EARLY_EXIT_CONFIDENCE_THRESHOLD = 0.85; 
export const KAPPA_PASS1_SCALE_CONFIDENCE_THRESHOLD = 0.80; 
export const KAPPA_MATCH_CONFIDENCE_THRESHOLD = 0.5; // General threshold for full/cropped icons
export const KAPPA_NMS_IOU_THRESHOLD = 0.1;
export const KAPPA_NMS_CONTAINMENT_THRESHOLD = 0.85;
export const FUSE_THRESHOLD_KAPPA = 0.35; // Uses direct value
export const KAPPA_NMS_IOU_THRESHOLD_P3_LENIENT = 1.1; // Value > 1.0 disables Containment check for P3 candidates
export const KAPPA_NMS_CONTAINMENT_THRESHOLD_P3_LENIENT = 1.1; // Value > 1.0 disables IoU check for P3 candidates
export const KAPPA_ITEM_ICON_BASE_PATH = './kappa_items'; // For main icons and unique_pixel icons

export const OPENCV_SCRIPT_URL = 'https://docs.opencv.org/4.x/opencv.js';
export const TESSERACT_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
export const FUSE_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js';