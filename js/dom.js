// js/dom.js

// Global Controls and Status
export const globalStatusDiv = document.getElementById('global-status');
export const container = document.querySelector('.container'); 
export const taskImagesGrid = document.getElementById('task-images-grid');
export const processAllButton = document.getElementById('process-all-tasks');
export const apiKeyInput = document.getElementById('api-key-input');
export const postCompletedTasksButton = document.getElementById('post-completed-tasks-button');

// Kappa Section Elements - these are relatively static once the page loads
export const kappaItemsSection = document.getElementById('kappa-items-section');
export const kappaFileInput = document.getElementById('upload-kappa-items');
export const kappaSpinner = document.getElementById('kappa-spinner-overlay'); 

export const kappaDomElements = kappaItemsSection ? {
    fileInput: kappaFileInput,
    originalCanvas: kappaItemsSection.querySelector('.original-canvas'),
    processedCanvas: kappaItemsSection.querySelector('.processed-canvas'),
    statusDiv: kappaItemsSection.querySelector('.kappa-status'),
    processButton: kappaItemsSection.querySelector('#process-kappa-items'),
    clearButton: kappaItemsSection.querySelector('#clear-kappa-items'),
    buttonsContainer: kappaItemsSection.querySelector('.kappa-buttons'),
    outputArea: kappaItemsSection.querySelector('.kappa-output'),
    outputHeader: kappaItemsSection.querySelector('.collapsible-header[data-target="output-kappa"]'),
    outputContent: kappaItemsSection.querySelector('.collapsible-content#output-kappa'),
    matchedItemsHeader: kappaItemsSection.querySelector('.collapsible-header[data-target="matched-kappa-items"]'),
    matchedItemsContent: kappaItemsSection.querySelector('.collapsible-content#matched-kappa-items'),
    matchedItemsListDiv: kappaItemsSection.querySelector('.matched-items-list'),
} : {}; // Provide an empty object if kappaItemsSection is not found to prevent errors