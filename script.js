const globalStatusDiv = document.getElementById('global-status');
const container = document.querySelector('.container'); 
const taskImagesGrid = document.getElementById('task-images-grid');
const processAllButton = document.getElementById('process-all-tasks');
const apiKeyInput = document.getElementById('api-key-input');
const postCompletedTasksButton = document.getElementById('post-completed-tasks-button');

const kappaItemsSection = document.getElementById('kappa-items-section');
const kappaFileInput = document.getElementById('upload-kappa-items');
const kappaOriginalCanvas = kappaItemsSection ? kappaItemsSection.querySelector('.original-canvas') : null;
const kappaProcessedCanvas = kappaItemsSection ? kappaItemsSection.querySelector('.processed-canvas') : null;
const kappaStatusDiv = kappaItemsSection ? kappaItemsSection.querySelector('.kappa-status') : null;
const kappaProcessButton = kappaItemsSection ? kappaItemsSection.querySelector('#process-kappa-items') : null;
const kappaClearButton = kappaItemsSection ? kappaItemsSection.querySelector('#clear-kappa-items') : null;
const kappaButtonsContainer = kappaItemsSection ? kappaItemsSection.querySelector('.kappa-buttons') : null;
const kappaOutputArea = kappaItemsSection ? kappaItemsSection.querySelector('.kappa-output') : null;
const kappaOutputHeader = kappaItemsSection ? kappaItemsSection.querySelector('.collapsible-header[data-target="output-kappa"]') : null;
const kappaOutputContent = kappaItemsSection ? kappaItemsSection.querySelector('.collapsible-content#output-kappa') : null;
const kappaMatchedItemsHeader = kappaItemsSection ? kappaItemsSection.querySelector('.collapsible-header[data-target="matched-kappa-items"]') : null;
const kappaMatchedItemsContent = kappaItemsSection ? kappaItemsSection.querySelector('.collapsible-content#matched-kappa-items') : null;
const kappaMatchedItemsListDiv = kappaItemsSection ? kappaItemsSection.querySelector('.matched-items-list') : null;


const IS_DEV_MODE = false;

let discriminantImage1 = null;
let discriminantImage2 = null;
let tarkovTasksData = []; // General task data
let kappaRequiredItemsData = []; // Specific items required for Kappa
let kappaRequiredItemIcons = {}; // Store loaded Kappa item icons
let taskTree = {};
let fuse; // Fuse for tasks
// Removed itemFuse as it's no longer needed for Kappa item matching


// Kappa task ID (The Collector)
const KAPPA_TASK_ID = "5c51aac186f77432ea65c552";

const DISCRIMINANT_IMAGE_PATHS = ['discriminant.png', 'discriminant2.png'];

const taskNames = ["Prapor", "Therapist", "Skier", "Peacekeeper", "Mechanic", "Ragman", "Jaeger", "Ref"];

const tasks = {};

// State for Kappa items
const kappaState = {
    image: null,
    processingResults: {
        foundItems: [], // Store found items with locations
        missingItems: [] // Store items not found
    }
};


const BRIGHTNESS_CHANGE_THRESHOLD = 20;
const BINARIZATION_THRESHOLD = 120;
const OCR_BOTTOM_PERCENTAGE = 0.9; // May need different values for Kappa
const FUSE_THRESHOLD = 0.4;
const KAPPA_MATCH_THRESHOLD = 0.7; // Confidence threshold for template matching

const API_KEY_STORAGE_KEY = 'tarkov_dev_api_key';

const saveApiKey = (key) => {
    if (key) {
        localStorage.setItem(API_KEY_STORAGE_KEY, key);
    } else {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
};

const loadApiKey = () => {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
};

window.addEventListener('load', () => {
    const savedApiKey = loadApiKey();
    if (apiKeyInput && savedApiKey) {
        apiKeyInput.value = savedApiKey;
    }
    checkIfReady();

    const praporTaskElement = document.getElementById('task-prapor');
    if (praporTaskElement) {
        praporTaskElement.classList.add('focused');
    }

    // Add focused class listener for Kappa section
     if (kappaItemsSection) {
         kappaItemsSection.addEventListener('click', () => {
              document.querySelectorAll('.task-container').forEach(container => {
                 container.classList.remove('focused');
             });
             document.querySelectorAll('.kappa-items-container').forEach(container => {
                 container.classList.remove('focused');
             });
             kappaItemsSection.classList.add('focused');
             console.log('Kappa section clicked, focused class added.'); // Log focus change
         });
     }

     // Ensure canvases are hidden on load
     if (kappaOriginalCanvas) kappaOriginalCanvas.style.display = 'none';
     if (kappaProcessedCanvas) kappaProcessedCanvas.style.display = 'none';
      taskNames.forEach(taskName => {
         const task = tasks[taskName];
         if (task && task.domElements) {
             if (task.domElements.originalCanvas) task.domElements.originalCanvas.style.display = 'none';
             if (task.domElements.processedCanvas) task.domElements.processedCanvas.style.display = 'none';
         }
      });

});

if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (event) => {
        saveApiKey(event.target.value);
        checkIfReady();
    });
}

const cleanStringForMatching = (str) => {
    return str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
};

const matchOcrLineToTask = (ocrLine, tarkovTasksData, traderName) => {
    const cleanedOcrLine = cleanStringForMatching(ocrLine);

    if (cleanedOcrLine.length === 0 || !fuse) {
        return null;
    }

    const options = {
        keys: ['name'],
        includeScore: true,
        threshold: FUSE_THRESHOLD,
        ignoreLocation: true,
        distance: 100,
        isCaseSensitive: false,
        findAllMatches: false,
        minMatchCharLength: 3
    };

    const relevantTasks = tarkovTasksData.filter(task =>
        task.trader && cleanStringForMatching(task.trader.name) === cleanStringForMatching(traderName)
    );

    if (relevantTasks.length === 0) {
        return null;
    }

    const traderFuse = new Fuse(relevantTasks, options);

    const result = traderFuse.search(cleanedOcrLine);

    if (result.length > 0 && result[0].score <= options.threshold) {
        return { task: result[0].item, score: result[0].score };
    } else {
        return null;
    }
};


const createElementFromHTML = (htmlString) => {
    const div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstChild;
};

const reportTaskStatus = (taskName, message) => {
    const task = tasks[taskName];
    if (task && task.domElements && task.domElements.statusDiv) {
        task.domElements.statusDiv.textContent = message;
    } else {
        console.error(`Error reporting status for task ${taskName}: Status div not found.`);
    }
};

// New function to report status for Kappa section
const reportKappaStatus = (message) => {
    if (kappaStatusDiv) {
        kappaStatusDiv.textContent = message;
    } else {
        console.error('Error reporting status for Kappa: Status div not found.');
    }
};


const reportTaskOutput = (taskName, message, append = false) => {
    const task = tasks[taskName];
    if (task && task.domElements && task.domElements.outputArea) {
        if (append) {
            task.domElements.outputArea.value += message;
        } else {
            task.domElements.outputArea.value = message;
        }
    } else {
        console.error(`Error reporting output for task ${taskName}: Output area not found.`);
    }
};

// New function to report output for Kappa section
const reportKappaOutput = (message, append = false) => {
     if (kappaOutputArea) {
         if (append) {
             kappaOutputArea.value += message;
         } else {
             kappaOutputArea.value = message;
         }
     } else {
         console.error('Error reporting output for Kappa: Output area not found.');
     }
};

function clearTask(taskName) {
     const task = tasks[taskName];
     if (!task || !task.domElements) {
         console.error(`Error clearing task ${taskName}: Task object or DOM elements not found.`);
         return;
     }

     task.image = null;
     task.processingResults.discriminant1Rect = null;
     task.processingResults.discriminant2Rect = null;
     task.processingResults.ocrRect = null;
     task.processingResults.identifiedCompletedTaskIds.clear();
     task.processingResults.requiredTasksToPost = [];

     const { originalCanvas, originalCtx, processedCanvas, processedCtx, fileInput, statusDiv, outputArea, wikiLinksDiv, requiredTasksDiv, outputHeader, outputContent, wikiHeader, wikiContent, requiredTasksHeader, requiredTasksContent, processButton, clearButton, taskButtonsContainer } = task.domElements;

     if (originalCtx) {
         originalCtx.clearRect(0, 0, originalCanvas.width, originalCanvas.height);
         originalCanvas.style.display = 'none';
     }
     if (processedCtx) {
         processedCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
         processedCanvas.style.display = 'none'; // Ensure processed canvas is also hidden
     }

     if (fileInput) {
         fileInput.value = '';
     }

     if (statusDiv) {
         statusDiv.textContent = 'Awaiting image upload.';
     }

     if (outputArea) {
         outputArea.value = '';
     }

     if (wikiLinksDiv) {
         wikiLinksDiv.innerHTML = '';
     }

     if (requiredTasksDiv) {
         requiredTasksDiv.innerHTML = '';
     }

    // Hide collapsible content and headers
     if (outputContent) outputContent.style.display = 'none';
     if (outputHeader) {
         outputHeader.style.display = 'none';
         outputHeader.classList.remove('active');
     }
     if (wikiContent) wikiContent.style.display = 'none';
     if (wikiHeader) {
         wikiHeader.style.display = 'none';
         wikiHeader.classList.remove('active');
     }
     if (requiredTasksContent) requiredTasksContent.style.display = 'none';
     if (requiredTasksHeader) {
         requiredTasksHeader.style.display = 'none';
         requiredTasksHeader.classList.remove('active');
     }


     if (taskButtonsContainer) {
         taskButtonsContainer.style.display = 'none';
     }

     if (processButton) {
         processButton.disabled = true;
     }
     if (clearButton) {
         clearButton.disabled = true;
     }

     checkIfReady();
}


function initializeTask(taskName) {
    const taskElement = createElementFromHTML(`
        <div class="task-container" id="task-${taskName.toLowerCase()}">
            <h3>${taskName}</h3>
            <div class="file-input-container">
                <label for="upload-${taskName.toLowerCase()}">Upload Image:</label>
                <input type="file" id="upload-${taskName.toLowerCase()}" accept="image/*">
            </div>
            <div class="canvas-container">
                <canvas class="task-canvas original-canvas"></canvas>
                <canvas class="task-canvas processed-canvas"></canvas>
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
    `);

    if (taskImagesGrid) {
        taskImagesGrid.appendChild(taskElement);
    } else {
        console.error("Error: taskImagesGrid not found.");
        return;
    }

    tasks[taskName] = {
        image: null,
        domElements: {
            taskElement: taskElement,
            originalCanvas: taskElement.querySelector('.original-canvas'),
            originalCtx: taskElement.querySelector('.original-canvas').getContext('2d'),
            processedCanvas: taskElement.querySelector('.processed-canvas'),
            processedCtx: taskElement.querySelector('.processed-canvas').getContext('2d'),
            statusDiv: taskElement.querySelector('.task-status'),
            outputArea: taskElement.querySelector('.task-output'),
            wikiLinksDiv: taskElement.querySelector('.wiki-links'),
            requiredTasksDiv: taskElement.querySelector('.required-tasks'),
            outputHeader: taskElement.querySelector('.collapsible-header[data-target="output-' + taskName.toLowerCase() + '"]'),
            outputContent: taskElement.querySelector('.collapsible-content#output-' + taskName.toLowerCase()),
            wikiHeader: taskElement.querySelector('.collapsible-header[data-target="wiki-' + taskName.toLowerCase() + '"]'),
            wikiContent: taskElement.querySelector('.collapsible-content#wiki-' + taskName.toLowerCase()),
            requiredTasksHeader: taskElement.querySelector('.collapsible-header[data-target="required-tasks-' + taskName.toLowerCase() + '"]'),
            requiredTasksContent: taskElement.querySelector('.collapsible-content#required-tasks-' + taskName.toLowerCase()),
            fileInput: taskElement.querySelector('input[type="file"]'),
            processButton: taskElement.querySelector('.process-task-button'),
            clearButton: taskElement.querySelector('.clear-task-button'),
            taskButtonsContainer: taskElement.querySelector('.task-buttons')
        },
        processingResults: {
            discriminant1Rect: null,
            discriminant2Rect: null,
            ocrRect: null,
            identifiedCompletedTaskIds: new Set(),
            requiredTasksToPost: []
        }
    };

    const task = tasks[taskName];

    // Hide collapsible content and headers initially
    if (task.domElements.outputContent) task.domElements.outputContent.style.display = 'none';
    if (task.domElements.outputHeader) task.domElements.outputHeader.style.display = 'none';
    if (task.domElements.wikiContent) task.domElements.wikiContent.style.display = 'none';
    if (task.domElements.wikiHeader) task.domElements.wikiHeader.style.display = 'none';
    if (task.domElements.requiredTasksContent) task.domElements.requiredTasksContent.style.display = 'none';
    if (task.domElements.requiredTasksHeader) task.domElements.requiredTasksHeader.style.display = 'none';

     // Ensure canvases are hidden initially
     if (task.domElements.originalCanvas) task.domElements.originalCanvas.style.display = 'none';
     if (task.domElements.processedCanvas) task.domElements.processedCanvas.style.display = 'none';


    if (task.domElements.fileInput) {
        task.domElements.fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            loadImageFile(file, (img) => {
                task.image = img;
                const { originalCanvas, originalCtx, processedCanvas, taskButtonsContainer } = task.domElements;

                originalCanvas.width = img.width;
                originalCanvas.height = img.height;
                originalCtx.clearRect(0, 0, img.width, img.height);
                originalCtx.drawImage(img, 0, 0, img.width, img.height);
                originalCanvas.style.display = 'block';

                if (processedCanvas) {
                     processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
                }

                reportTaskStatus(taskName, 'Image uploaded. Ready to process.');
                checkIfReady();

                task.processingResults.discriminant1Rect = null;
                task.processingResults.discriminant2Rect = null;
                task.processingResults.ocrRect = null;
                task.processingResults.identifiedCompletedTaskIds.clear();
                task.processingResults.requiredTasksToPost = [];

                reportTaskOutput(taskName, '');
                if (task.domElements.wikiLinksDiv) task.domElements.wikiLinksDiv.innerHTML = '';
                if (task.domElements.requiredTasksDiv) task.domElements.requiredTasksDiv.innerHTML = '';

                // Hide collapsible content and headers initially on new upload
                if (task.domElements.outputContent) task.domElements.outputContent.style.display = 'none';
                if (task.domElements.outputHeader) task.domElements.outputHeader.style.display = 'none';
                if (task.domElements.outputHeader) task.domElements.outputHeader.classList.remove('active');
                if (task.domElements.wikiContent) task.domElements.wikiContent.style.display = 'none';
                if (task.domElements.wikiHeader) task.domElements.wikiHeader.style.display = 'none';
                if (task.domElements.wikiHeader) task.domElements.wikiHeader.classList.remove('active');
                if (task.domElements.requiredTasksContent) task.domElements.requiredTasksContent.style.display = 'none';
                if (task.domElements.requiredTasksHeader) task.domElements.requiredTasksHeader.style.display = 'none';
                if (task.domElements.requiredTasksHeader) task.domElements.requiredTasksHeader.classList.remove('active');


                if (taskButtonsContainer) taskButtonsContainer.style.display = 'flex';
                if (task.domElements.processButton) task.domElements.processButton.disabled = false;
                if (task.domElements.clearButton) task.domElements.clearButton.disabled = false;
            });
        });
    } else {
        console.error(`Error: File input not found for task ${taskName}.`);
    }

    if (task.domElements.processButton) {
        task.domElements.processButton.addEventListener('click', async () => {
            await processSingleTask(taskName);
        });
    }

    if (task.domElements.clearButton) {
        task.domElements.clearButton.addEventListener('click', () => {
            clearTask(taskName);
        });
    }
}


taskNames.forEach(taskName => {
    initializeTask(taskName);
});

const praporTaskElement = document.getElementById('task-prapor');
if (praporTaskElement) {
    praporTaskElement.classList.add('focused');
}


if (container) { // Attach paste listener to the main container
    container.addEventListener('click', (event) => {
        const target = event.target;
        const header = target.closest('.collapsible-header');
        if (header && header.style.display !== 'none') {
            const contentId = header.dataset.target;
            const contentElement = document.getElementById(contentId);
            if (contentElement) {
                const hasContent = contentElement.textContent.trim().length > 0 || contentElement.querySelector('textarea')?.value.trim().length > 0 || contentElement.querySelector('ul')?.children.length > 0;
                if (hasContent || contentElement.id.startsWith('output-') || contentElement.id === 'matched-kappa-items') { // Include kappa matched items
                     contentElement.classList.toggle('active');
                     header.classList.toggle('active');
                     if (contentElement.classList.contains('active')) {
                         contentElement.style.display = 'block';
                     } else {
                         contentElement.style.display = 'none';
                     }
                }
            }
        }
    });

    container.addEventListener('click', (event) => {
        const target = event.target;
        const taskContainer = target.closest('.task-container');
        const kappaContainer = target.closest('.kappa-items-container');


        document.querySelectorAll('.task-container').forEach(container => {
            container.classList.remove('focused');
        });
         document.querySelectorAll('.kappa-items-container').forEach(container => {
             container.classList.remove('focused');
         });

        if (taskContainer) {
            taskContainer.classList.add('focused');
        } else if (kappaContainer) {
             kappaContainer.classList.add('focused');
        }
    });


    container.addEventListener('paste', (event) => { // Paste listener on the main container
        console.log('Paste event fired on container.'); // Log paste event
        const items = event.clipboardData.items;
        let imageFile = null;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                imageFile = items[i].getAsFile();
                console.log('Image file found in clipboard.'); // Log image file detection
                break;
            }
        }

        if (imageFile) {
            event.preventDefault();

            const focusedTaskContainer = container.querySelector('.task-container.focused');
            const focusedKappaContainer = container.querySelector('.kappa-items-container.focused');


            console.log('Focused Task container:', focusedTaskContainer ? focusedTaskContainer.id : 'None'); // Log focused task container
            console.log('Focused Kappa container:', focusedKappaContainer ? 'kappa-items-section' : 'None'); // Log focused kappa container


            if (focusedTaskContainer) {
                const taskName = focusedTaskContainer.id.replace('task-', '');
                 const task = tasks[taskName.charAt(0).toUpperCase() + taskName.slice(1)];

                if (task && task.domElements && task.domElements.fileInput) {
                    console.log(`Handling paste for task: ${taskName}`); // Log task paste handling
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(imageFile);

                    task.domElements.fileInput.files = dataTransfer.files;

                    const changeEvent = new Event('change', { bubbles: true });
                    task.domElements.fileInput.dispatchEvent(changeEvent);

                } else {
                     console.warn(`Paste event in focused task container, but could not find task object or file input for ${taskName}.`);
                }

            } else if (focusedKappaContainer) { // Check if Kappa container is focused
                 console.log('Handling paste for Kappa section.'); // Log kappa paste handling
                 // Directly load the image and update kappaState
                 loadImageFile(imageFile, (img) => {
                     console.log('Kappa image loaded after paste.'); // Log successful image load
                     kappaState.image = img;
                     drawKappaImageOnCanvas(); // Draw initial image
                     if (kappaOriginalCanvas) kappaOriginalCanvas.style.display = 'block';
                     if (kappaProcessedCanvas) kappaProcessedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';

                     reportKappaStatus('Image uploaded. Ready to process.');
                     checkIfReady();

                     kappaState.processingResults.foundItems = []; // Clear previous results
                     kappaState.processingResults.missingItems = [];
                     kappaState.processingResults.ocrRect = null;

                     reportKappaOutput('');
                     if (kappaMatchedItemsListDiv) kappaMatchedItemsListDiv.innerHTML = '';

                     if (kappaOutputContent) kappaOutputContent.style.display = 'none';
                     if (kappaOutputHeader) kappaOutputHeader.style.display = 'none';
                     if (kappaOutputHeader) kappaOutputHeader.classList.remove('active');
                     if (kappaMatchedItemsContent) kappaMatchedItemsContent.style.display = 'none';
                     if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.style.display = 'none';
                     if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.classList.remove('active');


                     if (kappaButtonsContainer) kappaButtonsContainer.style.display = 'flex';
                     if (kappaProcessButton) kappaProcessButton.disabled = false;
                     if (kappaClearButton) kappaClearButton.disabled = false;
                 });


            } else {
                 console.warn('Pasted image, but no task or kappa container is currently focused.');
                 globalStatusDiv.textContent = 'Pasted image, but no task or kappa container is currently focused. Click on a section before pasting.';
            }
        } else {
             console.warn('Paste event fired, but no image file found in clipboard items.'); // Log if no image file is found
             globalStatusDiv.textContent = 'Pasted content is not an image.';
        }
    });
} else {
    console.error('Error: Main container element not found.');
}


const drawTaskImageOnCanvas = (taskName) => {
     const task = tasks[taskName];
     const { originalCanvas, originalCtx } = task.domElements;
     const { image, processingResults } = task;

     if (!image || !originalCanvas || !originalCtx) return;

     const { width, height } = image;
     const ctx = originalCtx;

     ctx.canvas.width = width;
     ctx.canvas.height = height;

     ctx.clearRect(0, 0, width, height);
     ctx.drawImage(image, 0, 0, width, height);

     if (processingResults.ocrRect) {
         ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';

         if (processingResults.ocrRect.left > 0) {
             ctx.fillRect(0, 0, processingResults.ocrRect.left, height);
         }
         if (processingResults.ocrRect.top > 0) {
              ctx.fillRect(0, 0, width, processingResults.ocrRect.top);
         }

         const ocrRight = processingResults.ocrRect.left + processingResults.ocrRect.width;
         if (ocrRight < width) {
              ctx.fillRect(ocrRight, 0, width - ocrRight, height);
         }
         const ocrBottom = processingResults.ocrRect.top + processingResults.ocrRect.height;
         if (ocrBottom < height) {
              ctx.fillRect(0, ocrBottom, width, height - ocrBottom);
         }
     }

     if (processingResults.discriminant1Rect) {
         drawRect(ctx, processingResults.discriminant1Rect, 'rgba(0, 255, 0, 1.0)', 2);
     }
     if (processingResults.discriminant2Rect) {
         drawRect(ctx, processingResults.discriminant2Rect, 'rgba(0, 0, 255, 1.0)', 2);
     }
     if (processingResults.ocrRect) {
          drawRect(ctx, processingResults.ocrRect, 'rgba(255, 255, 0, 1.0)', 2);
     }
}

// New function to draw Kappa image on canvas
const drawKappaImageOnCanvas = () => {
     const { image, processingResults } = kappaState;
     const originalCanvas = kappaOriginalCanvas;
     const originalCtx = originalCanvas ? originalCanvas.getContext('2d') : null;

     if (!image || !originalCanvas || !originalCtx) return;

     const { width, height } = image;
     const ctx = originalCtx;

     ctx.canvas.width = width;
     ctx.canvas.height = height;

     ctx.clearRect(0, 0, width, height);
     ctx.drawImage(image, 0, 0, width, height);

     // Draw green rectangles around found items
     processingResults.foundItems.forEach(item => {
         item.locations.forEach(loc => {
             drawRect(ctx, loc, 'rgba(0, 255, 0, 1.0)', 2);
         });
     });
}


const drawRect = (ctx, rect, color, lineWidth) => {
     if (!ctx || !rect) return;
     ctx.strokeStyle = color;
     ctx.lineWidth = lineWidth;
     ctx.setLineDash([]);
     ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
};

const loadImageFile = (file, callback) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            callback(img);
        };
        img.onerror = () => {
            console.error('Error loading image file:', file.name);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

function loadImageFromUrl(url, callback) {
     const img = new Image();
     img.crossOrigin = 'anonymous'; // Required for drawing images from other domains
     img.onload = () => {
         callback(img);
     };
     img.onerror = (e) => {
         console.error('Error loading image from URL (likely CORS issue):', url, e);
         // Don't update global status for individual icon loading errors
         // You'll see the CORS error in the browser console.
         // To fix this, you need a server-side proxy or CORS headers on the image server.
         // For local development, temporarily disabling browser security might work but is NOT recommended.
     };
     img.src = url;
}

function buildTaskTree(tasksData) {
    const tree = {};

    tasksData.forEach(task => {
        tree[task.id] = {
            ...task,
            requiredBy: []
        };
    });

    tasksData.forEach(task => {
        if (task.taskRequirements && task.taskRequirements.length > 0) {
            task.taskRequirements.forEach(req => {
                if (req.task && tree[req.task.id]) {
                    if (!tree[req.task.id].requiredBy.some(t => t.id === task.id)) {
                         tree[req.task.id].requiredBy.push({ id: task.id, name: task.name });
                    }
                }
            });
        }
    });

    return tree;
}

function getRequiredCompletedTasks(identifiedTaskIds, taskTree) {
    const requiredTasks = new Set();
    const visited = new Set();

    function traverseRequirements(taskId) {
        if (visited.has(taskId)) {
            return;
        }
        visited.add(taskId);

        const task = taskTree[taskId];
        if (!task) {
            return;
        }

        if (task.taskRequirements && task.taskRequirements.length > 0) {
            task.taskRequirements.forEach(req => {
                if (req.task && taskTree[req.task.id]) {
                    requiredTasks.add(req.task.id);
                    traverseRequirements(req.task.id);
                }
            });
        }
    }

    identifiedTaskIds.forEach(taskId => {
        traverseRequirements(taskId);
    });

    const completedTasksList = Array.from(requiredTasks)
        .map(taskId => taskTree[taskId])
        .filter(task => task !== undefined);

    return completedTasksList;
}

async function fetchTarkovData() {
    reportGlobalStatus('Fetching data from Tarkov.dev...');
    const query = `
        query TarkovData {
            tasks(lang: en) {
                name
                id
                taskRequirements {
                    task {
                        name
                        id
                    }
                    status
                }
                trader {
                    name
                }
                wikiLink
            }
             task(id: "${KAPPA_TASK_ID}") { # Fetch specific Kappa task for required items
                 name
                 objectives {
                     ... on TaskObjectiveItem {
                         id
                         items {
                             name
                             id # Include ID for matching
                             iconLink # Include iconLink for potential image matching later
                             wikiLink # Include wikiLink for display
                         }
                     }
                 }
             }
        }
    `;

    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }

    try {
        const response = await fetch('https://api.tarkov.dev/graphql', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ query })
        });

        const data = await response.json();

        if (data.errors) {
            console.error('GraphQL errors:', data.errors);
            reportGlobalStatus('Error fetching data. Check console.');
            return null;
        }

        tarkovTasksData = data.data.tasks;
        console.log('Tarkov task data fetched:', tarkovTasksData);

        // Extract Kappa required items from the fetched data
        const kappaTask = data.data.task;
        if (kappaTask && kappaTask.objectives) {
            kappaRequiredItemsData = kappaTask.objectives.flatMap(objective =>
                objective.items ? objective.items : []
            );
            console.log('Kappa required items fetched:', kappaRequiredItemsData);

             // Load Kappa item icons
             reportGlobalStatus('Loading Kappa item icons...');
             const iconLoadPromises = kappaRequiredItemsData.map(item => {
                 return new Promise((resolve, reject) => {
                     if (!item.iconLink) {
                         console.warn(`No iconLink for item: ${item.name}`);
                         resolve(null); // Resolve with null if no iconLink
                         return;
                     }
                     loadImageFromUrl(item.iconLink, (img) => {
                         kappaRequiredItemIcons[item.id] = img;
                         resolve(img);
                     });
                 });
             });
             await Promise.all(iconLoadPromises);
             console.log('Kappa item icons loaded:', kappaRequiredItemIcons);

        } else {
            console.warn('Could not fetch Kappa task or its objectives.');
            kappaRequiredItemsData = [];
        }


        fuse = new Fuse(tarkovTasksData, {
             keys: ['name'],
             includeScore: true,
             threshold: FUSE_THRESHOLD,
             ignoreLocation: true,
             distance: 100,
             isCaseSensitive: false,
             findAllMatches: false,
             minMatchCharLength: 3
        });
        console.log('Fuse.js initialized with Tarkov task data.');

        // Removed itemFuse initialization as it's no longer needed for Kappa item matching

        taskTree = buildTaskTree(tarkovTasksData);
        console.log('Task tree built:', taskTree);

        checkIfReady();
        return { tasks: tarkovTasksData, kappaItems: kappaRequiredItemsData };

    } catch (error) {
        console.error('Error fetching Tarkov data:', error);
        reportGlobalStatus('Error fetching data. Check console.');
        return null;
    }
}


function checkIfReady() {
    const anyTaskImageUploaded = taskNames.some(taskName => tasks[taskName] && tasks[taskName].image !== null);
    const anyTaskMatched = taskNames.some(taskName => tasks[taskName] && tasks[taskName].processingResults && tasks[taskName].processingResults.requiredTasksToPost && tasks[taskName].processingResults.requiredTasksToPost.length > 0);
    const apiKeyPresent = apiKeyInput && apiKeyInput.value.trim() !== '';
    const kappaImageUploaded = kappaState.image !== null;
    // Check if all Kappa items are fetched and their icons are attempted to load (even if some failed due to CORS)
    const kappaRequiredItemsLoaded = kappaRequiredItemsData.length > 0 && kappaRequiredItemsData.every(item => kappaRequiredItemIcons[item.id] !== undefined || item.iconLink === undefined);


    if (tarkovTasksData.length > 0 && fuse && kappaRequiredItemsLoaded) {
         reportGlobalStatus('Task and Item data loaded. Upload images to begin.');
    } else {
         reportGlobalStatus('Loading dependencies...');
    }


    if (tarkovTasksData.length > 0 && anyTaskImageUploaded && fuse) {
        processAllButton.disabled = false;
    } else {
         processAllButton.disabled = true;
    }

    const anyTaskHasRequiredToPost = taskNames.some(taskName =>
        tasks[taskName] && tasks[taskName].processingResults && tasks[taskName].processingResults.requiredTasksToPost && tasks[taskName].processingResults.requiredTasksToPost.length > 0
    );

    if (anyTaskHasRequiredToPost && apiKeyPresent) {
        postCompletedTasksButton.disabled = false;
    } else {
        postCompletedTasksButton.disabled = true;
    }

     // Enable Kappa process button if image is uploaded and Kappa required item data and icons are loaded
     if (kappaImageUploaded && kappaRequiredItemsLoaded && kappaProcessButton) {
         kappaProcessButton.disabled = false;
     } else if (kappaProcessButton) {
         kappaProcessButton.disabled = true;
     }

     // Enable Kappa clear button if image is uploaded
     if (kappaImageUploaded && kappaClearButton) {
         kappaClearButton.disabled = false;
     } else if (kappaClearButton) {
         kappaClearButton.disabled = true;
     }
}

async function processSingleTask(taskName) {
    const task = tasks[taskName];
    const { image, domElements, processingResults } = task;

    processingResults.identifiedCompletedTaskIds.clear();
    processingResults.requiredTasksToPost = [];

    if (domElements.outputContent) domElements.outputContent.style.display = 'none';
    if (domElements.outputHeader) domElements.outputHeader.style.display = 'none';
    if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
    if (domElements.wikiContent) domElements.wikiContent.style.display = 'none';
    if (domElements.wikiHeader) domElements.wikiHeader.style.display = 'none';
    if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
    if (domElements.requiredTasksContent) domElements.requiredTasksContent.style.display = 'none';
    if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.style.display = 'none';
    if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');


    reportTaskOutput(taskName, '');
    if (domElements.wikiLinksDiv) domElements.wikiLinksDiv.innerHTML = '';
    if (domElements.requiredTasksDiv) domElements.requiredTasksDiv.innerHTML = '';


    if (!image && taskName !== "Ref") {
        reportTaskStatus(taskName, 'No image uploaded. Skipping.');
        return;
    }

     if (taskName === "Ref" && !image) {
        reportTaskOutput(taskName, 'No Ref image provided.');
        reportTaskStatus(taskName, 'Processing skipped (no image).');
        return;
    }

    reportTaskStatus(taskName, `Processing ${taskName}...`);

    try {
        cv = (cv instanceof Promise) ? await cv : cv;

        let src = cv.imread(image);
        let templ1 = cv.imread(discriminantImage1);
        let templ2 = cv.imread(discriminantImage2);
        let dst1 = new cv.Mat();
        let dst2 = new cv.Mat();
        let mask = new cv.Mat();

        if (src.channels() > 1) {
            cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
        }
         if (templ1.channels() > 1) {
             cv.cvtColor(templ1, templ1, cv.COLOR_RGBA2GRAY, 0);
         }
          if (templ2.channels() > 1) {
              cv.cvtColor(templ2, templ2, cv.COLOR_RGBA2GRAY, 0);
          }

        const searchRect = new cv.Rect(0, 0, image.width / 2, image.height);

        searchRect.width = Math.max(0, Math.min(searchRect.width, image.width));
        searchRect.height = Math.max(0, Math.min(searchRect.height, image.height));
        searchRect.x = Math.max(0, searchRect.x);
        searchRect.y = Math.max(0, searchRect.y);

        let srcRoi = null;
        if (searchRect.width > 0 && searchRect.height > 0) {
             srcRoi = src.roi(searchRect);
        } else {
             console.error(`Search area for discriminants in ${taskName} is invalid.`);
             reportTaskStatus(taskName, 'Search area for discriminants is invalid.');
             reportTaskOutput(taskName, 'Could not define a valid search area for the discriminants.');
             src.delete();
             templ1.delete();
             templ2.delete();
             dst1.delete();
             dst2.delete();
             mask.delete();
             if (domElements.originalCanvas) domElements.originalCanvas.style.display = 'none';
             if (domElements.processedCanvas) domElements.processedCanvas.style.display = 'none';
             return;
        }

        cv.matchTemplate(srcRoi, templ1, dst1, cv.TM_CCOEFF_NORMED, mask);
        cv.matchTemplate(srcRoi, templ2, dst2, cv.TM_CCOEFF_NORMED, mask);

        const minMaxResult1 = cv.minMaxLoc(dst1, mask);
        const matchLoc1 = minMaxResult1.maxLoc;

        const minMaxResult2 = cv.minMaxLoc(dst2, mask);
        const matchLoc2 = minMaxResult2.maxLoc;

        src.delete();
        templ1.delete();
        templ2.delete();
        dst1.delete();
        dst2.delete();
        srcRoi.delete();
        mask.delete();

        processingResults.discriminant1Rect = null;
        processingResults.discriminant2Rect = null;
        processingResults.ocrRect = null;

        let discriminantsFound = 0;

        if (minMaxResult1.maxVal > KAPPA_MATCH_THRESHOLD && matchLoc1.x >= 0 && matchLoc1.y >= 0 && matchLoc1.x < searchRect.width && matchLoc1.y < searchRect.height) {
             processingResults.discriminant1Rect = {
                 left: matchLoc1.x + searchRect.x,
                 top: matchLoc1.y + searchRect.y,
                 width: discriminantImage1.width,
                 height: discriminantImage1.height
             };
             discriminantsFound++;
        }

        if (minMaxResult2.maxVal > KAPPA_MATCH_THRESHOLD && matchLoc2.x >= 0 && matchLoc2.y >= 0 && matchLoc2.x < searchRect.width && matchLoc2.y < searchRect.height) {
             processingResults.discriminant2Rect = {
                 left: matchLoc2.x + searchRect.x,
                 top: matchLoc2.y + searchRect.y,
                 width: discriminantImage2.width,
                 height: discriminantImage2.height
             };
              discriminantsFound++;
        }

        if (processingResults.discriminant1Rect) {
            processingResults.discriminant1Rect.width = Math.max(0, Math.min(processingResults.discriminant1Rect.width, image.width - processingResults.discriminant1Rect.left));
            processingResults.discriminant1Rect.height = Math.max(0, Math.min(processingResults.discriminant1Rect.height, image.height - processingResults.discriminant1Rect.top));
            processingResults.discriminant1Rect.left = Math.max(0, processingResults.discriminant1Rect.left);
            processingResults.discriminant1Rect.top = Math.max(0, processingResults.discriminant1Rect.top);
        }
        if (processingResults.discriminant2Rect) {
            processingResults.discriminant2Rect.width = Math.max(0, Math.min(processingResults.discriminant2Rect.width, image.width - processingResults.discriminant2Rect.left));
            processingResults.discriminant2Rect.height = Math.max(0, Math.min(processingResults.discriminant2Rect.height, image.height - processingResults.discriminant2Rect.top));
            processingResults.discriminant2Rect.left = Math.max(0, processingResults.discriminant2Rect.left);
            processingResults.discriminant2Rect.top = Math.max(0, processingResults.discriminant2Rect.top);
        }

        if (discriminantsFound > 0) {
            reportTaskStatus(taskName, `${taskName}: Discriminants found. Defining OCR region...`);

            let leftmostDiscriminant = null;
            let rightmostDiscriminant = null;
            let lowerDiscriminant = null;

            if (processingResults.discriminant1Rect && processingResults.discriminant2Rect) {
                leftmostDiscriminant = processingResults.discriminant1Rect.left < processingResults.discriminant2Rect.left ? processingResults.discriminant1Rect : processingResults.discriminant2Rect;
                rightmostDiscriminant = processingResults.discriminant1Rect.left > processingResults.discriminant2Rect.left ? processingResults.discriminant1Rect : processingResults.discriminant2Rect;
                lowerDiscriminant = processingResults.discriminant1Rect.top > processingResults.discriminant2Rect.top ? processingResults.discriminant1Rect : processingResults.discriminant2Rect;
            } else if (processingResults.discriminant1Rect) {
                leftmostDiscriminant = processingResults.discriminant1Rect;
                rightmostDiscriminant = processingResults.discriminant1Rect;
                lowerDiscriminant = processingResults.discriminant1Rect;
            } else if (processingResults.discriminant2Rect) {
                 leftmostDiscriminant = processingResults.discriminant2Rect;
                 rightmostDiscriminant = processingResults.discriminant2Rect;
                 lowerDiscriminant = processingResults.discriminant2Rect;
            }

            const ocrBottom = image.height * OCR_BOTTOM_PERCENTAGE;

            if (leftmostDiscriminant && rightmostDiscriminant && lowerDiscriminant) {
                 processingResults.ocrRect = {
                     left: leftmostDiscriminant.left + leftmostDiscriminant.width,
                     top: lowerDiscriminant.top,
                     width: rightmostDiscriminant.left - (leftmostDiscriminant.left + leftmostDiscriminant.width),
                     height: ocrBottom - lowerDiscriminant.top
                 };
            } else {
                 processingResults.ocrRect = { left: 0, top: 0, width: 0, height: 0 };
                 console.error(`Could not determine leftmost/rightmost/lower discriminant for ${taskName}.`);
            }

            processingResults.ocrRect.width = Math.max(0, processingResults.ocrRect.width);
            processingResults.ocrRect.height = Math.max(0, processingResults.ocrRect.height);
            processingResults.ocrRect.left = Math.max(0, processingResults.ocrRect.left);
            processingResults.ocrRect.top = Math.max(0, processingResults.ocrRect.top);

            if (processingResults.ocrRect.top + processingResults.ocrRect.height > ocrBottom) {
                processingResults.ocrRect.height = ocrBottom - processingResults.ocrRect.top;
            }
            processingResults.ocrRect.height = Math.max(0, processingResults.ocrRect.height);

            drawTaskImageOnCanvas(taskName);

            if (processingResults.ocrRect.width > 0 && processingResults.ocrRect.height > 0) {
                 const tempProcessedCanvas = document.createElement('canvas');
                 tempProcessedCanvas.width = processingResults.ocrRect.width;
                 tempProcessedCanvas.height = processingResults.ocrRect.height;
                 const tempProcessedCtx = tempProcessedCanvas.getContext('2d');

                 tempProcessedCtx.drawImage(
                     image,
                     processingResults.ocrRect.left,
                     processingResults.ocrRect.top,
                     processingResults.ocrRect.width,
                     processingResults.ocrRect.height,
                     0, 0,
                     processingResults.ocrRect.width,
                     processingResults.ocrRect.height
                 );

                 const imageData = tempProcessedCtx.getImageData(0, 0, tempProcessedCanvas.width, tempProcessedCanvas.height);
                 const pixels = imageData.data;
                 const ocrWidth = tempProcessedCanvas.width;
                 const ocrHeight = tempProcessedCanvas.height;

                 let currentBlockStartRow = 0;
                 let previousLeftmostBrightness = -1;

                 for (let y = 0; y < ocrHeight; y++) {
                     const i = (y * ocrWidth + 0) * 4;
                     const r = pixels[i];
                     const g = pixels[i + 1];
                     const b = pixels[i + 2];
                     const currentLeftmostBrightness = (r + g + b) / 3;

                     if (previousLeftmostBrightness === -1) {
                         previousLeftmostBrightness = currentLeftmostBrightness;
                     }

                     const brightnessDifference = Math.abs(currentLeftmostBrightness - previousLeftmostBrightness);

                     if (brightnessDifference > BRIGHTNESS_CHANGE_THRESHOLD || y === ocrHeight - 1) {
                         const blockHeight = (y === ocrHeight - 1) ? (y - currentBlockStartRow + 1) : (y - currentBlockStartRow);
                         const blockStart = currentBlockStartRow;
                         const blockEnd = blockStart + blockHeight;

                         if (blockHeight > 0) {
                             let blockTotalBrightness = 0;
                             let blockPixelCount = 0;

                             for (let blockY = blockStart; blockY < blockEnd; blockY++) {
                                 for (let x = 0; x < ocrWidth; x++) {
                                     const pixelIndex = (blockY * ocrWidth + x) * 4;
                                     const pixelBrightness = (pixels[pixelIndex] + pixels[pixelIndex + 1] + pixels[pixelIndex + 2]) / 3;
                                     blockTotalBrightness += pixelBrightness;
                                     blockPixelCount++;
                                 }
                             }

                             const blockAverageBrightness = blockTotalBrightness / blockPixelCount;
                             const invertedBlockAverageBrightness = 255 - blockAverageBrightness;
                             const shouldInvertBlock = invertedBlockAverageBrightness > blockAverageBrightness;

                             for (let blockY = blockStart; blockY < blockEnd; blockY++) {
                                 for (let x = 0; x < ocrWidth; x++) {
                                     const pixelIndex = (blockY * ocrWidth + x) * 4;
                                     let r = pixels[pixelIndex];
                                     let g = pixels[pixelIndex + 1];
                                     let b = pixels[pixelIndex + 2];

                                     if (shouldInvertBlock) {
                                         r = 255 - r;
                                         g = 255 - g;
                                         b = 255 - b;
                                     }

                                     const brightness = (r + g + b) / 3;

                                     if (brightness < BINARIZATION_THRESHOLD) {
                                         pixels[pixelIndex] = 0;
                                         pixels[pixelIndex + 1] = 0;
                                         pixels[pixelIndex + 2] = 0;
                                     } else {
                                         pixels[pixelIndex] = 255;
                                         pixels[pixelIndex + 1] = 255;
                                         pixels[pixelIndex + 2] = 255;
                                     }
                                 }
                             }
                         }

                         currentBlockStartRow = y;
                         previousLeftmostBrightness = currentLeftmostBrightness;

                          if (y === ocrHeight - 1 && brightnessDifference <= BRIGHTNESS_CHANGE_THRESHOLD) {
                              const lastBlockHeight = y - currentBlockStartRow + 1;
                              if (lastBlockHeight > 0) {
                                   let lastBlockTotalBrightness = 0;
                                   let lastBlockPixelCount = 0;

                                   for (let blockY = currentBlockStartRow; blockY < y + 1; blockY++) {
                                        for (let x = 0; x < ocrWidth; x++) {
                                             const pixelIndex = (blockY * ocrWidth + x) * 4;
                                             const pixelBrightness = (pixels[pixelIndex] + pixels[pixelIndex + 1] + pixels[pixelIndex + 2]) / 3;
                                             lastBlockTotalBrightness += pixelBrightness;
                                             lastBlockPixelCount++;
                                         }
                                   }
                                   const lastBlockAverageBrightness = lastBlockTotalBrightness / lastBlockPixelCount;
                                   const invertedLastBlockAverageBrightness = 255 - lastBlockAverageBrightness;
                                   const shouldInvertLastBlock = invertedLastBlockAverageBrightness > lastBlockAverageBrightness;

                                   for (let blockY = currentBlockStartRow; blockY < y + 1; blockY++) {
                                       for (let x = 0; x < ocrWidth; x++) {
                                            const pixelIndex = (blockY * ocrWidth + x) * 4;
                                             let r = pixels[pixelIndex];
                                             let g = pixels[pixelIndex + 1];
                                             let b = pixels[pixelIndex + 2];

                                             if (shouldInvertLastBlock) {
                                                 r = 255 - r;
                                                 g = 255 - g;
                                                 b = 255 - b;
                                             }
                                              const brightness = (r + g + b) / 3;
                                              if (brightness < BINARIZATION_THRESHOLD) {
                                                 pixels[pixelIndex] = 0;
                                                 pixels[pixelIndex + 1] = 0;
                                                 pixels[pixelIndex + 2] = 0;
                                             } else {
                                                 pixels[pixelIndex] = 255;
                                                 pixels[pixelIndex + 1] = 255;
                                                 pixels[pixelIndex + 2] = 255;
                                              }
                                       }
                                   }
                               }
                           }
                     }
                 }

                 tempProcessedCtx.putImageData(imageData, 0, 0);

                 domElements.processedCanvas.width = tempProcessedCanvas.width;
                 domElements.processedCanvas.height = tempProcessedCanvas.height;
                 domElements.processedCtx.clearRect(0, 0, domElements.processedCanvas.width, domElements.processedCanvas.height);
                 domElements.processedCtx.drawImage(tempProcessedCanvas, 0, 0);

                  if (domElements.processedCanvas) {
                      domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
                  }

                 reportTaskStatus(taskName, `${taskName}: Image processing complete. Starting OCR...`);

                  if (domElements.processedCanvas) {
                      let worker = await Tesseract.createWorker('eng', 1, {
                           logger: m => {
                              if (m.status === 'recognizing') {
                                  reportTaskStatus(taskName, `Extracting text: ${taskName}: ${Math.round(m.progress * 100)}%`);
                              } else {
                                  reportTaskStatus(taskName, `OCR: ${taskName}: ${m.status}`);
                               }
                           }
                      });

                      worker.setParameters({
                          tessedit_char_whitelist: ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
                          tessedit_pageseg_mode: Tesseract.PSM.AUTO
                      });

                      const result = await worker.recognize(domElements.processedCanvas);
                      let extractedText = result.data.text;

                      await worker.terminate();

                       let extractedLines = extractedText.split('\n').filter(line => line.trim().length > 0);

                       const substringsToReplace = ["activel", "active!", "activet", "active ", "active:"];
                       extractedLines = extractedLines.map(line => {
                           let modifiedLine = line;
                           modifiedLine = modifiedLine.replace(/\bactive\b[^a-zA-Z0-9]*/gi, '').trim();
                           substringsToReplace.forEach(sub => {
                                modifiedLine = modifiedLine.replace(new RegExp(sub, 'gi'), '').trim();
                           });
                           return modifiedLine;
                       }).filter(line => line.length > 0);

                       const matchedResults = [];
                       processingResults.identifiedCompletedTaskIds.clear();

                       extractedLines.forEach(line => {
                           const matchedTask = matchOcrLineToTask(line, tarkovTasksData, taskName);
                           if (matchedTask) {
                               matchedResults.push({
                                   ocrLine: line.trim(),
                                   task: matchedTask.task,
                                   score: matchedTask.score
                               });
                               processingResults.identifiedCompletedTaskIds.add(matchedTask.task.id);
                           } else {
                                if (IS_DEV_MODE) {
                                    matchedResults.push({
                                        ocrLine: line.trim(),
                                        task: null,
                                        score: null
                                    });
                                }
                           }
                       });

                       let output = '';
                       let wikiLinksHtml = '';

                       if (IS_DEV_MODE) {
                           output += '--- OCR Line Matches (Dev Mode) ---\n';
                           matchedResults.forEach(result => {
                               if (result.task) {
                                   output += `"${result.ocrLine}" => "${result.task.name}" (Trader: ${result.task.trader.name}, Fuse Score: ${result.score.toFixed(4)})\n`;
                                   if (result.task.wikiLink) {
                                        wikiLinksHtml += `<li><a href="${result.task.wikiLink}" target="_blank">${result.task.name} Wiki</a></li>`;
                                   }
                               } else {
                                    output += `"${result.ocrLine}" => No Match\n`;
                                }
                           });
                           if (matchedResults.length === 0) {
                                output += 'No OCR lines extracted or matched for this trader.';
                           }

                       } else {
                            output += '--- Matched Tasks ---\n';
                            const matchedTasksOnly = matchedResults.filter(result => result.task !== null);
                            if (matchedTasksOnly.length > 0) {
                                matchedTasksOnly.forEach(result => {
                                     output += `"${result.ocrLine}" matched to "${result.task.name}"\n`;
                                     if (result.task.wikiLink) {
                                         wikiLinksHtml += `<li><a href="${result.task.wikiLink}" target="_blank">${result.task.name} Wiki</a></li>`;
                                     }
                                });
                            } else {
                                output += 'No tasks matched any OCR line for this trader.';
                            }
                       }

                       reportTaskOutput(taskName, output);

                       if (domElements.wikiLinksDiv && wikiLinksHtml) {
                           domElements.wikiLinksDiv.innerHTML = '<h4>Wiki Links:</h4><ul>' + wikiLinksHtml + '</ul>';
                           if (domElements.wikiHeader) domElements.wikiHeader.style.display = 'block';
                           if (domElements.wikiContent) domElements.wikiContent.style.display = 'none';
                       } else {
                            if (domElements.wikiLinksDiv) domElements.wikiLinksDiv.innerHTML = '';
                            if (domElements.wikiHeader) domElements.wikiHeader.style.display = 'none';
                            if (domElements.wikiContent) domElements.wikiContent.style.display = 'none';
                            if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
                       }

                       if (domElements.requiredTasksDiv && Object.keys(taskTree).length > 0) {
                            const requiredCompletedTasks = getRequiredCompletedTasks(Array.from(processingResults.identifiedCompletedTaskIds), taskTree);
                            processingResults.requiredTasksToPost = requiredCompletedTasks.map(task => task.id);

                            let requiredTasksHtml = '';
                            if (requiredCompletedTasks.length > 0) {
                                requiredTasksHtml += '<h4>Required Completed Tasks:</h4><ul>';
                                requiredCompletedTasks.sort((a, b) => a.name.localeCompare(b.name));
                                requiredCompletedTasks.forEach(reqTask => {
                                    requiredTasksHtml += `<li>${reqTask.name} (${reqTask.id})</li>`;
                                });
                                requiredTasksHtml += '</ul>';
                            } else {
                                 requiredTasksHtml = 'No specific prerequisite tasks identified based on OCR results.';
                            }
                            domElements.requiredTasksDiv.innerHTML = requiredTasksHtml;

                            if (requiredTasksHtml.trim().length > 0 && requiredTasksHtml !== 'No specific prerequisite tasks identified based on OCR results.') {
                                if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.style.display = 'block';
                                if (domElements.requiredTasksContent) domElements.requiredTasksContent.style.display = 'none';
                            } else {
                                 if (domElements.requiredTasksDiv) domElements.requiredTasksDiv.innerHTML = '';
                                 if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.style.display = 'none';
                                 if (domElements.requiredTasksContent) domElements.requiredTasksContent.style.display = 'none';
                                 if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
                            }
                       } else if (domElements.requiredTasksDiv) {
                            domElements.requiredTasksDiv.innerHTML = 'Task dependency data not available.';
                             if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.style.display = 'block';
                             if (domElements.requiredTasksContent) domElements.requiredTasksContent.style.display = 'none';
                             if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
                       }

                       if (output.trim().length > 0) {
                            if (domElements.outputHeader) domElements.outputHeader.style.display = 'block';
                            if (domElements.outputContent) domElements.outputContent.style.display = 'none';
                       } else {
                            if (domElements.outputHeader) domElements.outputHeader.style.display = 'none';
                            if (domElements.outputContent) domElements.outputContent.style.display = 'none';
                            if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
                       }


                       reportTaskStatus(taskName, `Processing complete for ${taskName}.`);

                  } else {
                       reportTaskOutput(taskName, 'Failed to prepare image for OCR.');
                       reportTaskStatus(taskName, 'Failed to prepare image for OCR.');
                       if (domElements.outputHeader) domElements.outputHeader.style.display = 'block';
                       if (domElements.outputContent) domElements.outputContent.style.display = 'none';
                  }
            } else {
                processingResults.requiredTasksToPost = [];
                reportTaskOutput(taskName, 'Calculated OCR region is invalid (zero width or height).');
                reportTaskStatus(taskName, 'OCR region invalid.');
                drawTaskImageOnCanvas(taskName);
                if (domElements.processedCanvas) domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
                if (domElements.outputHeader) domElements.outputHeader.style.display = 'block';
                if (domElements.outputContent) domElements.outputContent.style.display = 'none';
            }

        } else {
            processingResults.discriminant1Rect = null;
            processingResults.discriminant2Rect = null;
            processingResults.ocrRect = null;
            processingResults.requiredTasksToPost = [];
            reportTaskOutput(taskName, 'One or both discriminant shapes not found.');
            reportTaskStatus(taskName, 'Discriminants not found.');
            drawTaskImageOnCanvas(taskName);
            if (domElements.processedCanvas) domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
            if (domElements.outputHeader) domElements.outputHeader.style.display = 'block';
            if (domElements.outputContent) domElements.outputContent.style.display = 'none';
        }
    } catch (error) {
        console.error(`Error processing ${taskName}:`, error);
        reportTaskStatus(taskName, `Error processing ${taskName}. Check console.`);
        reportTaskOutput(taskName, `Error: ${error.message}`);
        processingResults.requiredTasksToPost = [];
        if (domElements.processedCanvas) domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
        if (domElements.outputHeader) domElements.outputHeader.style.display = 'block';
        if (domElements.outputContent) domElements.outputContent.style.display = 'none';
    } finally {
        checkIfReady();
    }
}

// New function to process Kappa image using template matching
async function processKappaImage() {
    if (!kappaState.image) {
        reportKappaStatus('No image uploaded for Kappa items.');
        return;
    }

    // Filter out items for which the icon failed to load (likely due to CORS)
    const itemsToDetect = kappaRequiredItemsData.filter(item => kappaRequiredItemIcons[item.id] !== undefined);

    if (itemsToDetect.length === 0) {
         reportKappaStatus('No Kappa item icons loaded. Cannot process.');
         // Display all items as missing if no icons could be loaded
         kappaState.processingResults.missingItems = [...kappaRequiredItemsData];
         displayMatchedKappaItems();
         if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.style.display = 'block';
         if (kappaMatchedItemsContent) kappaMatchedItemsContent.style.display = 'block';
         return;
    }


    reportKappaStatus('Processing Kappa image...');
    reportKappaOutput('Starting Kappa item detection...');

    kappaState.processingResults.foundItems = [];
    kappaState.processingResults.missingItems = [];

    const src = cv.imread(kappaState.image);
    const srcGray = new cv.Mat();
    cv.cvtColor(src, srcGray, cv.COLOR_RGBA2GRAY, 0);

    const foundItemIds = new Set();

    for (const item of itemsToDetect) {
        const iconImage = kappaRequiredItemIcons[item.id];
        // We already filtered out items without icons, so iconImage should exist here
        if (!iconImage) continue;


        const templ = cv.imread(iconImage);
        const templGray = new cv.Mat();
        cv.cvtColor(templ, templGray, cv.COLOR_RGBA2GRAY, 0);

        const dst = new cv.Mat();
        const mask = new cv.Mat();

        try {
            // Use the original image size for matchTemplate to get correct coordinates
            cv.matchTemplate(srcGray, templGray, dst, cv.TM_CCOEFF_NORMED, mask);

            // Find multiple matches by thresholding the result
            cv.threshold(dst, dst, KAPPA_MATCH_THRESHOLD, 1, cv.THRESH_BINARY);

            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

            let itemFoundLocations = [];
            for (let i = 0; i < contours.size(); ++i) {
                let rect = cv.boundingRect(contours.get(i));
                 // The rect from boundingRect on the thresholded result in matchTemplate coordinates
                 // corresponds to the top-left corner of the template match.
                 // The width and height should be the template's dimensions.
                 const originalRect = {
                     left: rect.x,
                     top: rect.y,
                     width: templGray.cols,
                     height: templGray.rows
                 };
                itemFoundLocations.push(originalRect);
            }

            if (itemFoundLocations.length > 0) {
                kappaState.processingResults.foundItems.push({
                    item: item,
                    locations: itemFoundLocations
                });
                foundItemIds.add(item.id);
                reportKappaOutput(`Found "${item.name}" ${itemFoundLocations.length} time(s).\n`, true);
            }


        } catch (error) {
            console.error(`Error during template matching for ${item.name}:`, error);
            reportKappaOutput(`Error detecting "${item.name}": ${error.message}\n`, true);
            // Don't add to missing items here, it's handled after the loop
        } finally {
            templ.delete();
            templGray.delete();
            dst.delete();
            mask.delete();
            contours.delete();
            hierarchy.delete();
        }
    }

    // Identify truly missing items (those not found at all)
    // Include items that failed to load icons as missing
    kappaState.processingResults.missingItems = kappaRequiredItemsData.filter(item => !foundItemIds.has(item.id));


    src.delete();
    srcGray.delete();


    drawKappaImageOnCanvas(); // Redraw canvas with rectangles

    displayMatchedKappaItems(); // Update the missing items list

    reportKappaStatus('Kappa item detection complete.');

     if (kappaOutputContent) kappaOutputContent.style.display = 'block';
     if (kappaOutputHeader) kappaOutputHeader.style.display = 'block';
     // Only show matched items content if there are items to display (found or missing)
     if (kappaState.processingResults.foundItems.length > 0 || kappaState.processingResults.missingItems.length > 0) {
         if (kappaMatchedItemsContent) kappaMatchedItemsContent.style.display = 'block';
         if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.style.display = 'block';
     }


    checkIfReady();
}

// New function to clear Kappa section
const clearKappaImage = () => {
    kappaState.image = null;
    kappaState.processingResults.foundItems = [];
    kappaState.processingResults.missingItems = [];
    kappaState.processingResults.ocrRect = null; // Keep this in case we add OCR back later

    if (kappaOriginalCanvas) {
        const ctx = kappaOriginalCanvas.getContext('2d');
        ctx.clearRect(0, 0, kappaOriginalCanvas.width, kappaOriginalCanvas.height);
        kappaOriginalCanvas.style.display = 'none';
    }
    if (kappaProcessedCanvas) {
        const ctx = kappaProcessedCanvas.getContext('2d');
        ctx.clearRect(0, 0, kappaProcessedCanvas.width, kappaProcessedCanvas.height);
        kappaProcessedCanvas.style.display = 'none';
    }

    if (kappaFileInput) {
        kappaFileInput.value = '';
    }

    reportKappaOutput('');
    if (kappaMatchedItemsListDiv) kappaMatchedItemsListDiv.innerHTML = '';

    if (kappaOutputContent) kappaOutputContent.style.display = 'none';
    if (kappaOutputHeader) kappaOutputHeader.style.display = 'none';
    if (kappaOutputHeader) kappaOutputHeader.classList.remove('active');
    if (kappaMatchedItemsContent) kappaMatchedItemsContent.style.display = 'none';
    if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.style.display = 'none';
    if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.classList.remove('active');


    if (kappaButtonsContainer) kappaButtonsContainer.style.display = 'none';

    reportKappaStatus('Awaiting image upload.');

    if (kappaProcessButton) kappaProcessButton.disabled = true;
    if (kappaClearButton) kappaClearButton.disabled = true;

    checkIfReady();
};

// New function to display matched Kappa items (now focuses on missing items)
const displayMatchedKappaItems = () => {
    if (kappaMatchedItemsListDiv) {
        let itemsHtml = '';
        if (kappaState.processingResults.missingItems.length > 0) {
            itemsHtml += '<h4>Missing Items:</h4><ul>';
            kappaState.processingResults.missingItems.sort((a, b) => a.name.localeCompare(b.name));
            kappaState.processingResults.missingItems.forEach(item => {
                itemsHtml += `<li>${item.name} (${item.id}) - <a href="${item.wikiLink}" target="_blank">Wiki</a></li>`;
            });
            itemsHtml += '</ul>';
        } else if (kappaState.processingResults.foundItems.length > 0) {
             itemsHtml = 'All required Kappa items found in the image!';
        } else {
             itemsHtml = 'No Kappa items detected yet.';
        }
        kappaMatchedItemsListDiv.innerHTML = itemsHtml;

        // Show the header if there are missing items or if all items were found
        if (kappaState.processingResults.missingItems.length > 0 || kappaState.processingResults.foundItems.length > 0) {
             if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.style.display = 'block';
             if (kappaMatchedItemsContent) kappaMatchedItemsContent.style.display = 'none'; // Keep content hidden by default
        } else {
             if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.style.display = 'none';
             if (kappaMatchedItemsContent) kappaMatchedItemsContent.style.display = 'none';
             if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.classList.remove('active');
        }
    }
};


processAllButton.addEventListener('click', async () => {
     if (!discriminantImage1 || !discriminantImage2 || tarkovTasksData.length === 0 || Object.keys(taskTree).length === 0 || !fuse) {
         reportGlobalStatus('Error: Dependencies not loaded.');
         return;
     }

     processAllButton.disabled = true;
     postCompletedTasksButton.disabled = true;
     reportGlobalStatus('Starting processing all images...');

     const processingPromises = taskNames.map(taskName => processSingleTask(taskName));

     await Promise.all(processingPromises);

     reportGlobalStatus('Processing of all images complete.');
     checkIfReady();
});

postCompletedTasksButton.addEventListener('click', async () => {
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';

    if (!apiKey) {
        reportGlobalStatus('Please enter your TarkovTracker API key.');
        return;
    }

    postCompletedTasksButton.disabled = true;
    reportGlobalStatus('Preparing tasks for posting...');

    const tasksToPost = [];
    taskNames.forEach(taskName => {
        const task = tasks[taskName];
        if (task && task.processingResults && task.processingResults.requiredTasksToPost && task.processingResults.requiredTasksToPost.length > 0) {
            task.processingResults.requiredTasksToPost.forEach(taskId => {
                if (!tasksToPost.some(task => task.id === taskId)) {
                     tasksToPost.push({ id: taskId, state: "completed" });
                }
            });
        }
    });

    if (tasksToPost.length === 0) {
        reportGlobalStatus('No completed tasks identified to post.');
        postCompletedTasksButton.disabled = false;
        return;
    }

    reportGlobalStatus(`Posting ${tasksToPost.length} completed tasks to TarkovTracker...`);

    const postUrl = `https://tarkovtracker.io/api/v2/progress/tasks/`;

    const headers = {
        'accept': '*/*',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
    };

    try {
        const response = await fetch(postUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(tasksToPost)
        });

        if (response.ok) {
            console.log(`Successfully posted ${tasksToPost.length} tasks as completed.`);
            reportGlobalStatus(`Successfully posted ${tasksToPost.length} tasks as completed.`);

            tasksToPost.forEach(postedTask => {
                 taskNames.forEach(taskName => {
                    const task = tasks[taskName];
                    if (task && task.processingResults && task.processingResults.identifiedCompletedTaskIds.has(postedTask.id)) {
                         reportTaskOutput(taskName, `\nPosted task ${postedTask.id} as completed to TarkovTracker.`, true);
                    }
                 });
            });

        } else {
            const errorText = await response.text();
            console.error(`Failed to post tasks. Status: ${response.status}. Response: ${errorText}`);
            reportGlobalStatus(`Failed to post tasks. Status: ${response.status}.`);

             tasksToPost.forEach(postedTask => {
                 taskNames.forEach(taskName => {
                    const task = tasks[taskName];
                    if (task && task.processingResults && task.processingResults.identifiedCompletedTaskIds.has(postedTask.id)) {
                        reportTaskOutput(taskName, `\nFailed to post task ${postedTask.id}. Status: ${response.status}.`, true);
                    }
                 });
             });
        }
    } catch (error) {
        console.error(`Error during fetch for batch update:`, error);
        reportGlobalStatus(`Error posting tasks: ${error.message}`);

         tasksToPost.forEach(postedTask => {
             taskNames.forEach(taskName => {
                const task = tasks[taskName];
                if (task && task.processingResults && task.processingResults.identifiedCompletedTaskIds.has(postedTask.id)) {
                    reportTaskOutput(taskName, `\nError posting task ${postedTask.id}: ${error.message}`, true);
                }
             });
         });
    } finally {
        checkIfReady();
    }
});


reportGlobalStatus('Loading dependencies...');

const loadOpenCv = new Promise((resolve, reject) => {
    if (typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined') {
        console.log('OpenCV.js already initialized.');
        resolve();
    } else if (typeof cv !== 'undefined' && cv.onRuntimeInitialized) {
         cv.onRuntimeInitialized = () => {
             console.log('OpenCV.js runtime initialized.');
             resolve();
         };
    } else {
         console.log('Waiting for OpenCV.js runtime initialization.');
         if (typeof cv !== 'undefined') {
             cv.onRuntimeInitialized = () => {
                 console.log('OpenCV.js runtime initialized.');
                 resolve();
             };
         } else {
             console.error("OpenCV.js object 'cv' not found. Ensure the script is loaded correctly.");
             reject(new Error("OpenCV.js object 'cv' not found."));
         }
    }
});

const loadFuse = new Promise((resolve) => {
    if (typeof Fuse !== 'undefined') {
        console.log('Fuse.js already loaded.');
        resolve();
    } else {
         console.log('Assuming Fuse.js is loaded via HTML.');
         resolve();
    }
});

Promise.all([
     loadOpenCv,
     loadFuse,
     fetchTarkovData(), // Fetch both tasks and items, and load Kappa icons
     new Promise((resolve, reject) => {
         loadImageFromUrl(DISCRIMINANT_IMAGE_PATHS[0], (img) => {
             discriminantImage1 = img;
             resolve();
         });
     }),
     new Promise((resolve, reject) => {
          loadImageFromUrl(DISCRIMINANT_IMAGE_PATHS[1], (img) => {
              discriminantImage2 = img;
              resolve();
          });
     })
]).then(() => {
     checkIfReady();
}).catch(error => {
     console.error("Error loading dependencies:", error);
     reportGlobalStatus('Error loading dependencies. Check console for details.');
     processAllButton.disabled = true;
     postCompletedTasksButton.disabled = true;
     if (kappaProcessButton) kappaProcessButton.disabled = true;
     if (kappaClearButton) kappaClearButton.disabled = true;
});

taskNames.forEach(taskName => {
     const task = tasks[taskName];
     if (task && task.domElements) {
         if (task.domElements.originalCanvas) task.domElements.originalCanvas.style.display = 'none';
         if (task.domElements.processedCanvas) task.domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
         if (task.domElements.outputArea) task.domElements.outputArea.value = '';
         if (task.domElements.wikiLinksDiv) task.domElements.wikiLinksDiv.innerHTML = '';
         if (task.domElements.requiredTasksDiv) task.domElements.requiredTasksDiv.innerHTML = '';

         if (task.domElements.outputContent) task.domElements.outputContent.style.display = 'none';
         if (task.domElements.outputHeader) task.domElements.outputHeader.style.display = 'none';
         if (task.domElements.outputHeader) task.domElements.outputHeader.classList.remove('active');
         if (task.domElements.wikiContent) task.domElements.wikiContent.style.display = 'none';
         if (task.domElements.wikiHeader) task.domElements.wikiHeader.style.display = 'none';
         if (task.domElements.wikiHeader) task.domElements.wikiHeader.classList.remove('active');
         if (task.domElements.requiredTasksContent) task.domElements.requiredTasksContent.style.display = 'none';
         if (task.domElements.requiredTasksHeader) task.domElements.requiredTasksHeader.style.display = 'none';
         if (task.domElements.requiredTasksHeader) task.domElements.requiredTasksHeader.classList.remove('active');


         if (task.domElements.taskButtonsContainer) task.domElements.taskButtonsContainer.style.display = 'none';

         if (task.domElements.processButton) task.domElements.processButton.disabled = true;
         if (task.domElements.clearButton) task.domElements.clearButton.disabled = true;
     }
});

// Initialize Kappa section state and display
if (kappaOriginalCanvas) kappaOriginalCanvas.style.display = 'none';
if (kappaProcessedCanvas) kappaProcessedCanvas.style.display = 'none'; // Ensure processed canvas is also hidden initially
if (kappaOutputArea) kappaOutputArea.value = '';
if (kappaMatchedItemsListDiv) kappaMatchedItemsListDiv.innerHTML = '';

if (kappaOutputContent) kappaOutputContent.style.display = 'none';
if (kappaOutputHeader) kappaOutputHeader.style.display = 'none';
if (kappaOutputHeader) kappaOutputHeader.classList.remove('active');
if (kappaMatchedItemsContent) kappaMatchedItemsContent.style.display = 'none';
if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.style.display = 'none';
if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.classList.remove('active');


if (kappaButtonsContainer) kappaButtonsContainer.style.display = 'none';

reportKappaStatus('Awaiting image upload.');

// Add event listeners for Kappa file input and buttons
if (kappaFileInput) {
    kappaFileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        loadImageFile(file, (img) => {
            kappaState.image = img;
            drawKappaImageOnCanvas(); // Draw initial image
            if (kappaOriginalCanvas) kappaOriginalCanvas.style.display = 'block';
            // Only show processed canvas in dev mode after image load
            if (kappaProcessedCanvas) kappaProcessedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';


            reportKappaStatus('Image uploaded. Ready to process.');
            checkIfReady();

            kappaState.processingResults.foundItems = []; // Clear previous results
            kappaState.processingResults.missingItems = [];
            kappaState.processingResults.ocrRect = null; // Keep this in case we add OCR back later


            reportKappaOutput('');
            if (kappaMatchedItemsListDiv) kappaMatchedItemsListDiv.innerHTML = '';

            if (kappaOutputContent) kappaOutputContent.style.display = 'none';
            if (kappaOutputHeader) kappaOutputHeader.style.display = 'none';
            if (kappaOutputHeader) kappaOutputHeader.classList.remove('active');
            if (kappaMatchedItemsContent) kappaMatchedItemsContent.style.display = 'none';
            if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.style.display = 'none';
            if (kappaMatchedItemsHeader) kappaMatchedItemsHeader.classList.remove('active');


            if (kappaButtonsContainer) kappaButtonsContainer.style.display = 'flex';
            if (kappaProcessButton) kappaProcessButton.disabled = false;
            if (kappaClearButton) kappaClearButton.disabled = false;
        });
    });
}

if (kappaProcessButton) {
    kappaProcessButton.addEventListener('click', async () => {
        await processKappaImage();
    });
}

if (kappaClearButton) {
    kappaClearButton.addEventListener('click', () => {
        clearKappaImage();
    });
}

// Add collapsible header functionality for Kappa section
if (kappaItemsSection) {
    kappaItemsSection.addEventListener('click', (event) => {
        const target = event.target;
        const header = target.closest('.collapsible-header');
        if (header && header.style.display !== 'none') {
            const contentId = header.dataset.target;
            const contentElement = document.getElementById(contentId);
            if (contentElement) {
                 const hasContent = contentElement.textContent.trim().length > 0 || contentElement.querySelector('textarea')?.value.trim().length > 0 || contentElement.querySelector('ul')?.children.length > 0;
                 if (hasContent || contentElement.id === 'output-kappa' || contentElement.id === 'matched-kappa-items') { // Allow both output and matched items headers to toggle
                     contentElement.classList.toggle('active');
                     header.classList.toggle('active');
                     if (contentElement.classList.contains('active')) {
                         contentElement.style.display = 'block';
                     } else {
                         contentElement.style.display = 'none';
                     }
                 }
            }
        }
    });
}

// Helper function to report global status
function reportGlobalStatus(message) {
    if (globalStatusDiv) {
        globalStatusDiv.textContent = message;
    }
}
