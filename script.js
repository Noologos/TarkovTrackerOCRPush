const globalStatusDiv = document.getElementById('global-status');
const taskImagesGrid = document.getElementById('task-images-grid');
const processAllButton = document.getElementById('process-all-tasks');
const apiKeyInput = document.getElementById('api-key-input');
const postCompletedTasksButton = document.getElementById('post-completed-tasks-button');

const IS_DEV_MODE = false;

let discriminantImage1 = null;
let discriminantImage2 = null;
let tarkovTasksData = [];
let taskTree = {};
let fuse;

const DISCRIMINANT_IMAGE_PATHS = ['discriminant.png', 'discriminant2.png'];

const taskNames = ["Prapor", "Therapist", "Skier", "Peacekeeper", "Mechanic", "Ragman", "Jaeger", "Ref"];

const tasks = {};

const BRIGHTNESS_CHANGE_THRESHOLD = 20;
const BINARIZATION_THRESHOLD = 120;
const OCR_BOTTOM_PERCENTAGE = 0.9;
const FUSE_THRESHOLD = 0.4;

const API_KEY_STORAGE_KEY = 'tarkov_dev_api_key';

function saveApiKey(key) {
    if (key) {
        localStorage.setItem(API_KEY_STORAGE_KEY, key);
    } else {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
}

function loadApiKey() {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
}

window.addEventListener('load', () => {
    const savedApiKey = loadApiKey();
    if (apiKeyInput && savedApiKey) {
        apiKeyInput.value = savedApiKey;
    }
    checkIfReady();

    // Set Prapor as focused by default on load
    const praporTaskElement = document.getElementById('task-prapor');
    if (praporTaskElement) {
        praporTaskElement.classList.add('focused');
    }
});

if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (event) => {
        saveApiKey(event.target.value);
        checkIfReady();
    });
}

function cleanStringForMatching(str) {
    return str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
}

function matchOcrLineToTask(ocrLine, tarkovTasksData, traderName) {
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
}

function createElementFromHTML(htmlString) {
    const div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstChild;
}

function reportTaskStatus(taskName, message) {
    const task = tasks[taskName];
    if (task && task.domElements && task.domElements.statusDiv) {
        task.domElements.statusDiv.textContent = message;
    } else {
        console.error(`Error reporting status for task ${taskName}: Status div not found.`);
    }
}

function reportTaskOutput(taskName, message, append = false) {
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

            <div class="collapsible-header" data-target="output-${taskName.toLowerCase()}">OCR Output</div>
            <div class="collapsible-content" id="output-${taskName.toLowerCase()}">
                 <textarea class="task-output" readonly></textarea>
            </div>

            <div class="collapsible-header" data-target="wiki-${taskName.toLowerCase()}">Wiki Links</div>
            <div class="collapsible-content" id="wiki-${taskName.toLowerCase()}">
                 <div class="wiki-links"></div>
            </div>

             <div class="collapsible-header" data-target="required-tasks-${taskName.toLowerCase()}">Required Completed Tasks</div>
            <div class="collapsible-content" id="required-tasks-${taskName.toLowerCase()}">
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
            fileInput: taskElement.querySelector('input[type="file"]')
        },
        processingResults: {
            discriminant1Rect: null,
            discriminant2Rect: null,
            ocrRect: null,
            identifiedCompletedTaskIds: new Set(),
            requiredTasksToPost: [] // Initialize the array to store task IDs to post
        }
    };

    const task = tasks[taskName];

    if (task.domElements.fileInput) {
        task.domElements.fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            loadImageFile(file, (img) => {
                task.image = img;
                const { originalCanvas, originalCtx, processedCanvas } = task.domElements;

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
                task.processingResults.requiredTasksToPost = []; // Clear the array on new image

                reportTaskOutput(taskName, '');
                if (task.domElements.wikiLinksDiv) task.domElements.wikiLinksDiv.innerHTML = '';
                if (task.domElements.requiredTasksDiv) task.domElements.requiredTasksDiv.innerHTML = '';

                if (task.domElements.outputContent) task.domElements.outputContent.classList.remove('active');
                if (task.domElements.outputHeader) task.domElements.outputHeader.classList.remove('active');
                if (task.domElements.wikiContent) task.domElements.wikiContent.classList.remove('active');
                if (task.domElements.wikiHeader) task.domElements.wikiHeader.classList.remove('active');
                if (task.domElements.requiredTasksContent) task.domElements.requiredTasksContent.classList.remove('active');
                if (task.domElements.requiredTasksHeader) task.domElements.requiredTasksHeader.classList.remove('active');
            });
        });
    } else {
        console.error(`Error: File input not found for task ${taskName}.`);
    }
}

taskNames.forEach(taskName => {
    initializeTask(taskName);
});

// Add the focused class to the Prapor task container by default
const praporTaskElement = document.getElementById('task-prapor');
if (praporTaskElement) {
    praporTaskElement.classList.add('focused');
}


if (taskImagesGrid) {
    // Event delegation for collapsible headers
    taskImagesGrid.addEventListener('click', (event) => {
        const target = event.target;
        const header = target.closest('.collapsible-header');
        if (header) {
            const contentId = header.dataset.target;
            const contentElement = document.getElementById(contentId);
            if (contentElement) {
                contentElement.classList.toggle('active');
                header.classList.toggle('active');
            }
        }
    });

    // Event delegation for task container highlighting
    taskImagesGrid.addEventListener('click', (event) => {
        const target = event.target;
        const taskContainer = target.closest('.task-container');

        // Remove 'focused' class from all task containers first
        document.querySelectorAll('.task-container').forEach(container => {
            container.classList.remove('focused');
        });

        // Add 'focused' class to the clicked task container if found
        if (taskContainer) {
            taskContainer.classList.add('focused');
        }
    });


    // Add paste event listener to the grid
    taskImagesGrid.addEventListener('paste', (event) => {
        const items = event.clipboardData.items;
        let imageFile = null;

        // Find the first image file in the clipboard items
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                imageFile = items[i].getAsFile();
                break;
            }
        }

        if (imageFile) {
            // Prevent default paste behavior
            event.preventDefault();

            // Find the task container with the 'focused' class
            const taskContainer = document.querySelector('.task-container.focused');

            if (taskContainer) {
                const taskName = taskContainer.id.replace('task-', '');
                 const task = tasks[taskName.charAt(0).toUpperCase() + taskName.slice(1)]; // Capitalize first letter

                if (task && task.domElements && task.domElements.fileInput) {
                    // Create a DataTransfer object and add the file to it
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(imageFile);

                    // Assign the DataTransfer object's files to the file input
                    task.domElements.fileInput.files = dataTransfer.files;

                    // Manually trigger a change event on the file input
                    const changeEvent = new Event('change', { bubbles: true });
                    task.domElements.fileInput.dispatchEvent(changeEvent);

                } else {
                     console.warn(`Paste event in focused task container, but could not find task object or file input for ${taskName}.`);
                }

            } else {
                 console.warn('Pasted image, but no task container is currently focused.');
                 globalStatusDiv.textContent = 'Pasted image, but no task container is currently focused. Click on a task container before pasting.';
            }
        }
    });
}

function drawTaskImageOnCanvas(taskName) {
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

function drawRect(ctx, rect, color, lineWidth) {
     if (!ctx || !rect) return;
     ctx.strokeStyle = color;
     ctx.lineWidth = lineWidth;
     ctx.setLineDash([]);
     ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
}

function loadImageFile(file, callback) {
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
}

function loadImageFromUrl(url, callback) {
     const img = new Image();
     img.crossOrigin = 'anonymous';
     img.onload = () => {
         callback(img);
     };
     img.onerror = (e) => {
         console.error('Error loading discriminant image from URL:', url, e);
         globalStatusDiv.textContent = `Error loading discriminant image from ${url}. Please ensure the file exists at that path and CORS is configured correctly.`;
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

async function fetchTarkovTasks() {
    globalStatusDiv.textContent = 'Fetching task data...';
    const query = `
        {
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
            globalStatusDiv.textContent = 'Error fetching task data. Check console.';
            return null;
        }

        tarkovTasksData = data.data.tasks;
        console.log('Tarkov task data fetched:', tarkovTasksData);

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

        taskTree = buildTaskTree(tarkovTasksData);
        console.log('Task tree built:', taskTree);

        checkIfReady();
        return tarkovTasksData;

    } catch (error) {
        console.error('Error fetching Tarkov task data:', error);
        globalStatusDiv.textContent = 'Error fetching task data. Check console.';
        return null;
    }
}

function checkIfReady() {
    const anyTaskImageUploaded = taskNames.some(taskName => tasks[taskName] && tasks[taskName].image !== null);
    const anyTaskMatched = taskNames.some(taskName => tasks[taskName] && tasks[taskName].processingResults && tasks[taskName].processingResults.identifiedCompletedTaskIds.size > 0);
    const apiKeyPresent = apiKeyInput && apiKeyInput.value.trim() !== '';

    if (tarkovTasksData.length > 0 && anyTaskImageUploaded && fuse) {
        processAllButton.disabled = false;
        globalStatusDiv.textContent = 'Task data loaded. Upload images and click "Process All" to begin.';
    } else if (tarkovTasksData.length > 0 && fuse) {
         globalStatusDiv.textContent = 'Task data loaded. Upload task images to enable processing.';
         processAllButton.disabled = true;
    } else {
         processAllButton.disabled = true;
         globalStatusDiv.textContent = 'Loading dependencies...';
    }

    // Enable post button if any task has identified completed tasks AND API key is present
    const anyTaskHasRequiredToPost = taskNames.some(taskName =>
        tasks[taskName] && tasks[taskName].processingResults && tasks[taskName].processingResults.requiredTasksToPost && tasks[taskName].processingResults.requiredTasksToPost.length > 0
    );

    if (anyTaskHasRequiredToPost && apiKeyPresent) {
        postCompletedTasksButton.disabled = false;
    } else {
        postCompletedTasksButton.disabled = true;
    }
}

async function processSingleTask(taskName) {
    const task = tasks[taskName];
    const { image, domElements, processingResults } = task;

    processingResults.identifiedCompletedTaskIds.clear();
    processingResults.requiredTasksToPost = []; // Clear the array before processing

    if (!image && taskName !== "Ref") {
        reportTaskStatus(taskName, 'No image uploaded. Skipping.');
        reportTaskOutput(taskName, '');
        if (domElements.outputContent) domElements.outputContent.classList.remove('active');
        if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
        if (domElements.wikiLinksDiv) domElements.wikiLinksDiv.innerHTML = '';
        if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
        if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
        if (domElements.requiredTasksDiv) domElements.requiredTasksDiv.innerHTML = '';
        if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
        if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
        if (domElements.originalCanvas) domElements.originalCanvas.style.display = 'none';
        if (domElements.processedCanvas) domElements.processedCanvas.style.display = 'none';
        return;
    }

     if (taskName === "Ref" && !image) {
        reportTaskOutput(taskName, 'No Ref image provided.');
        reportTaskStatus(taskName, 'Processing skipped (no image).');
        if (domElements.outputContent) domElements.outputContent.classList.remove('active');
        if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
        if (domElements.wikiLinksDiv) domElements.wikiLinksDiv.innerHTML = '';
        if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
        if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
        if (domElements.requiredTasksDiv) domElements.requiredTasksDiv.innerHTML = '';
        if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
        if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
        if (domElements.originalCanvas) domElements.originalCanvas.style.display = 'none';
        if (domElements.processedCanvas) domElements.processedCanvas.style.display = 'none';
        return;
    }

    reportTaskOutput(taskName, '');
    if (domElements.wikiLinksDiv) domElements.wikiLinksDiv.innerHTML = '';
    if (domElements.requiredTasksDiv) domElements.requiredTasksDiv.innerHTML = '';
    if (domElements.outputContent) domElements.outputContent.classList.remove('active');
    if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
    if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
    if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
    if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
    if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');

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
             if (domElements.outputContent) domElements.outputContent.classList.remove('active');
             if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
             if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
             if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
             if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
             if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
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

        if (matchLoc1.x >= 0 && matchLoc1.y >= 0 && matchLoc1.x < searchRect.width && matchLoc1.y < searchRect.height) {
             processingResults.discriminant1Rect = {
                 left: matchLoc1.x + searchRect.x,
                 top: matchLoc1.y + searchRect.y,
                 width: discriminantImage1.width,
                 height: discriminantImage1.height
             };
             discriminantsFound++;
        }

        if (matchLoc2.x >= 0 && matchLoc2.y >= 0 && matchLoc2.x < searchRect.width && matchLoc2.y < searchRect.height) {
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

                       if (domElements.wikiLinksDiv) {
                           if (wikiLinksHtml) {
                               domElements.wikiLinksDiv.innerHTML = '<h4>Wiki Links:</h4><ul>' + wikiLinksHtml + '</ul>';
                           } else {
                                domElements.wikiLinksDiv.innerHTML = '';
                                if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
                                if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
                           }
                       }

                       if (domElements.requiredTasksDiv && Object.keys(taskTree).length > 0) {
                            const requiredCompletedTasks = getRequiredCompletedTasks(Array.from(processingResults.identifiedCompletedTaskIds), taskTree);
                            // Store the IDs of required tasks to post
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
                            } else {
                                 if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
                                 if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
                            }
                       } else if (domElements.requiredTasksDiv) {
                            domElements.requiredTasksDiv.innerHTML = 'Task dependency data not available.';
                             if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
                             if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
                       }

                       reportTaskStatus(taskName, `Processing complete for ${taskName}.`);

                  } else {
                       reportTaskOutput(taskName, 'Failed to prepare image for OCR.');
                       reportTaskStatus(taskName, 'Failed to prepare image for OCR.');
                        if (domElements.outputContent) domElements.outputContent.classList.remove('active');
                        if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
                        if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
                        if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
                        if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
                        if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
                  }
            } else {
                processingResults.requiredTasksToPost = []; // Ensure this is empty if OCR fails
                reportTaskOutput(taskName, 'Calculated OCR region is invalid (zero width or height).');
                reportTaskStatus(taskName, 'OCR region invalid.');
                drawTaskImageOnCanvas(taskName);
                if (domElements.processedCanvas) domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
                 if (domElements.outputContent) domElements.outputContent.classList.remove('active');
                 if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
                 if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
                 if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
                 if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
                 if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
            }

        } else {
            processingResults.discriminant1Rect = null;
            processingResults.discriminant2Rect = null;
            processingResults.ocrRect = null;
            processingResults.requiredTasksToPost = []; // Ensure this is empty if discriminants not found
            reportTaskOutput(taskName, 'One or both discriminant shapes not found.');
            reportTaskStatus(taskName, 'Discriminants not found.');
            drawTaskImageOnCanvas(taskName);
            if (domElements.processedCanvas) domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
            if (domElements.outputContent) domElements.outputContent.classList.remove('active');
            if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
            if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
            if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
            if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
            if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
        }
    } catch (error) {
        console.error(`Error processing ${taskName}:`, error);
        reportTaskStatus(taskName, `Error processing ${taskName}. Check console.`);
        reportTaskOutput(taskName, `Error: ${error.message}`);
        processingResults.requiredTasksToPost = []; // Ensure this is empty on error
        if (domElements.processedCanvas) domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
        if (domElements.outputContent) domElements.outputContent.classList.remove('active');
        if (domElements.outputHeader) domElements.outputHeader.classList.remove('active');
        if (domElements.wikiContent) domElements.wikiContent.classList.remove('active');
        if (domElements.wikiHeader) domElements.wikiHeader.classList.remove('active');
        if (domElements.requiredTasksContent) domElements.requiredTasksContent.classList.remove('active');
        if (domElements.requiredTasksHeader) domElements.requiredTasksHeader.classList.remove('active');
    } finally {
        checkIfReady(); // Re-check button state after processing each task
    }
}

processAllButton.addEventListener('click', async () => {
     if (!discriminantImage1 || !discriminantImage2 || tarkovTasksData.length === 0 || Object.keys(taskTree).length === 0 || !fuse) {
         globalStatusDiv.textContent = 'Error: Dependencies not loaded.';
         return;
     }

     processAllButton.disabled = true;
     postCompletedTasksButton.disabled = true; // Disable post button during processing
     globalStatusDiv.textContent = 'Starting processing...';

     const processingPromises = taskNames.map(taskName => processSingleTask(taskName));

     await Promise.all(processingPromises);

     globalStatusDiv.textContent = 'Processing complete.';
     checkIfReady(); // Re-check button state after all tasks are processed
});

postCompletedTasksButton.addEventListener('click', async () => {
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';

    if (!apiKey) {
        globalStatusDiv.textContent = 'Please enter your TarkovTracker API key.';
        return;
    }

    postCompletedTasksButton.disabled = true;
    globalStatusDiv.textContent = 'Preparing tasks for posting...';

    // Collect all required task IDs from all processed tasks
    const tasksToPost = [];
    taskNames.forEach(taskName => {
        const task = tasks[taskName];
        // Check if the task was processed and has required tasks identified
        if (task && task.processingResults && task.processingResults.requiredTasksToPost && task.processingResults.requiredTasksToPost.length > 0) {
            task.processingResults.requiredTasksToPost.forEach(taskId => {
                // Add task ID to the list if not already present
                if (!tasksToPost.some(task => task.id === taskId)) {
                     tasksToPost.push({ id: taskId, state: "completed" });
                }
            });
        }
    });

    if (tasksToPost.length === 0) {
        globalStatusDiv.textContent = 'No completed tasks identified to post.';
        postCompletedTasksButton.disabled = false; // Re-enable if nothing to post
        return;
    }

    globalStatusDiv.textContent = `Posting ${tasksToPost.length} completed tasks to TarkovTracker...`;

    // New API endpoint for batch updates
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
            body: JSON.stringify(tasksToPost) // Send the array of tasks
        });

        if (response.ok) {
            console.log(`Successfully posted ${tasksToPost.length} tasks as completed.`);
            globalStatusDiv.textContent = `Successfully posted ${tasksToPost.length} tasks as completed.`;

            // Optional: Update task outputs to indicate successful posting
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
            globalStatusDiv.textContent = `Failed to post tasks. Status: ${response.status}.`;

            // Optional: Update task outputs to indicate failed posting
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
        globalStatusDiv.textContent = `Error posting tasks: ${error.message}`;

        // Optional: Update task outputs to indicate fetch error
         tasksToPost.forEach(postedTask => {
             taskNames.forEach(taskName => {
                const task = tasks[taskName];
                if (task && task.processingResults && task.processingResults.identifiedCompletedTaskIds.has(postedTask.id)) {
                    reportTaskOutput(taskName, `\nError posting task ${postedTask.id}: ${error.message}`, true);
                }
             });
         });
    } finally {
        checkIfReady(); // Re-enable buttons after posting attempt
    }
});


globalStatusDiv.textContent = 'Loading dependencies...';

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
     fetchTarkovTasks(),
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
     globalStatusDiv.textContent = 'Error loading dependencies. Check console for details.';
     processAllButton.disabled = true;
     postCompletedTasksButton.disabled = true;
});

taskNames.forEach(taskName => {
     const task = tasks[taskName];
     if (task && task.domElements) {
         if (task.domElements.originalCanvas) task.domElements.originalCanvas.style.display = 'none';
         if (task.domElements.processedCanvas) task.domElements.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
         if (task.domElements.outputArea) task.domElements.outputArea.value = '';
         if (task.domElements.wikiLinksDiv) task.domElements.wikiLinksDiv.innerHTML = '';
         if (task.domElements.requiredTasksDiv) task.domElements.requiredTasksDiv.innerHTML = '';

         // Changed from 'active' to 'focused'
         if (task.domElements.outputContent) task.domElements.outputContent.classList.remove('active');
         if (task.domElements.outputHeader) task.domElements.outputHeader.classList.remove('active');
         if (task.domElements.wikiContent) task.domElements.wikiContent.classList.remove('active');
         if (task.domElements.wikiHeader) task.domElements.wikiHeader.classList.remove('active');
         if (task.domElements.requiredTasksContent) task.domElements.requiredTasksContent.classList.remove('active');
         if (task.domElements.requiredTasksHeader) task.domElements.requiredTasksHeader.classList.remove('active');
     }
});
