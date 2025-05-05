const globalStatusDiv = document.getElementById('global-status');
const taskImagesGrid = document.getElementById('task-images-grid');
const processAllButton = document.getElementById('process-all-tasks');
const apiKeyInput = document.getElementById('api-key-input'); // Get the API key input element
const postCompletedTasksButton = document.getElementById('post-completed-tasks-button'); // Get the new button

// Constant to control Developer Mode (true for ON, false for OFF)
const IS_DEV_MODE = false; // Set to false as requested, now managed internally

let discriminantImage1 = null; // Stores the first discriminant image data
let discriminantImage2 = null; // Stores the second discriminant image data
let tarkovTasksData = []; // Store the fetched Tarkov tasks data
let taskTree = {}; // Object to store the task dependency tree
let fuse; // Declare fuse variable here

// Paths to the discriminant images
const DISCRIMINANT_IMAGE_PATHS = ['discriminant.png', 'discriminant2.png'];

// List of task names (these correspond to trader names for matching)
const taskNames = ["Prapor", "Therapist", "Skier", "Peacekeeper", "Mechanic", "Ragman", "Jaeger", "Ref"];

// Object to store data for each task
const tasks = {};

// --- Save/Load API Key using localStorage ---
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

// Load the API key when the page loads
window.addEventListener('load', () => {
    const savedApiKey = loadApiKey();
    if (apiKeyInput && savedApiKey) {
        apiKeyInput.value = savedApiKey;
    }
});

// Save the API key whenever the input field changes
if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (event) => {
        saveApiKey(event.target.value);
        checkIfReady(); // Check button state when API key changes
    });
}
// --- End Save/Load API Key ---


function cleanStringForMatching(str) {
    // Keep hyphens for task names like "Gendarmerie-MallCop"
    return str.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim();
}

// --- Match a Single OCR Line to a Task (Fuzzy Match using Fuse.js) ---
// Finds the best matching Tarkov task for a single OCR extracted line
// using Fuse.js for fuzzy matching.
// Returns the best matching task object or null if no satisfactory match found.
function matchOcrLineToTask(ocrLine, tarkovTasksData, traderName) {
    const cleanedOcrLine = cleanStringForMatching(ocrLine);

    if (cleanedOcrLine.length === 0 || !fuse) {
        return null; // Cannot perform fuzzy match without cleaned line or initialized fuse
    }

    // Fuse.js options for fuzzy matching
    const options = {
        keys: ['name'], // Search in the 'name' property of task objects
        includeScore: true, // Include the matching score in the results
        threshold: 0.4, // Adjust this threshold (0 is perfect match, 1 is no match)
        ignoreLocation: true, // Don't penalize matches based on location in the string
        distance: 100, // Consider matches up to this distance (in characters)
        isCaseSensitive: false, // Case-insensitive matching
        findAllMatches: false, // Only find the best match
        minMatchCharLength: 3 // Minimum number of characters to match
    };

    // Filter tasks by trader before searching
    const relevantTasks = tarkovTasksData.filter(task =>
        task.trader && cleanStringForMatching(task.trader.name) === cleanStringForMatching(traderName)
    );

    if (relevantTasks.length === 0) {
        return null; // No tasks for this trader
    }

    // Create a new Fuse instance for the relevant tasks
    const traderFuse = new Fuse(relevantTasks, options);

    // Perform the fuzzy search
    const result = traderFuse.search(cleanedOcrLine);

    // Return the best match if one is found and its score is within the threshold
    if (result.length > 0 && result[0].score <= options.threshold) {
        // Fuse.js returns an array of results, the best match is the first one
        // result[0].item is the original task object
        // result[0].score is the matching score (lower is better)
        return { task: result[0].item, score: result[0].score };
    } else {
        return null; // No satisfactory match found
    }
}


function createTaskHtml(taskName) {
    return `
        <div class="task-container" id="task-${taskName.toLowerCase()}" tabindex="0"> <h3>${taskName}</h3>
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
    `;
}

taskNames.forEach(taskName => {
    taskImagesGrid.innerHTML += createTaskHtml(taskName);
    tasks[taskName] = {
        image: null,
        originalCanvas: null,
        originalCtx: null,
        processedCanvas: null,
        processedCtx: null,
        statusDiv: null,
        outputArea: null,
        discriminant1Rect: null,
        discriminant2Rect: null,
        ocrRect: null,
        wikiLinksDiv: null,
        outputHeader: null, // Reference to the OCR Output header
        outputContent: null, // Reference to the OCR Output content div
        wikiHeader: null, // Reference to the Wiki Links header
        wikiContent: null, // Reference to the Wiki Links content div
        requiredTasksDiv: null, // Reference to the Required Tasks div
        requiredTasksHeader: null, // Reference to the Required Tasks header
        requiredTasksContent: null, // Reference to the Required Tasks content div
        identifiedCompletedTaskIds: new Set() // Set to store IDs of tasks identified as completed for this container
    };
});

taskNames.forEach(taskName => {
    const taskElement = document.getElementById(`task-${taskName.toLowerCase()}`);
    tasks[taskName].originalCanvas = taskElement.querySelector('.original-canvas');
    tasks[taskName].originalCtx = tasks[taskName].originalCanvas.getContext('2d');
    tasks[taskName].processedCanvas = taskElement.querySelector('.processed-canvas');
    tasks[taskName].processedCtx = tasks[taskName].processedCanvas.getContext('2d');
    tasks[taskName].statusDiv = taskElement.querySelector('.task-status');
    tasks[taskName].outputArea = taskElement.querySelector('.task-output');
    tasks[taskName].wikiLinksDiv = taskElement.querySelector('.wiki-links');
    tasks[taskName].outputHeader = taskElement.querySelector('.collapsible-header[data-target="output-' + taskName.toLowerCase() + '"]');
    tasks[taskName].outputContent = taskElement.querySelector('.collapsible-content#output-' + taskName.toLowerCase());
    tasks[taskName].wikiHeader = taskElement.querySelector('.collapsible-header[data-target="wiki-' + taskName.toLowerCase() + '"]');
    tasks[taskName].wikiContent = taskElement.querySelector('.collapsible-content#wiki-' + taskName.toLowerCase());
    tasks[taskName].requiredTasksDiv = taskElement.querySelector('.required-tasks');
    tasks[taskName].requiredTasksHeader = taskElement.querySelector('.collapsible-header[data-target="required-tasks-' + taskName.toLowerCase() + '"]');
    tasks[taskName].requiredTasksContent = taskElement.querySelector('.collapsible-content#required-tasks-' + taskName.toLowerCase());

    const fileInput = taskElement.querySelector('input[type="file"]');

    // --- Paste functionality ---
    taskElement.addEventListener('focus', () => {
        // Add paste listener when the task container is focused
        document.addEventListener('paste', handlePaste);
    });

    taskElement.addEventListener('blur', () => {
        // Remove paste listener when the task container loses focus
        document.removeEventListener('paste', handlePaste);
    });

    function handlePaste(event) {
        const items = event.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            // Check if the item is an image
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    // Create a DataTransfer object to simulate file input change
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(blob);
                    fileInput.files = dataTransfer.files;

                    // Trigger the change event on the file input
                    const changeEvent = new Event('change', { bubbles: true });
                    fileInput.dispatchEvent(changeEvent);

                    // Prevent the default paste action (e.g., pasting into a text field if one is focused)
                    event.preventDefault();
                    break; // Stop processing after finding the first image
                }
            }
        }
    }
    // --- End Paste functionality ---


    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        loadImageFile(file, (img) => {
            tasks[taskName].image = img;
            tasks[taskName].originalCanvas.width = img.width;
            tasks[taskName].originalCanvas.height = img.height;
            tasks[taskName].originalCtx.clearRect(0, 0, img.width, img.height);
            tasks[taskName].originalCtx.drawImage(img, 0, 0, img.width, img.height);
            tasks[taskName].originalCanvas.style.display = 'block';

            if (tasks[taskName].processedCanvas) {
                 tasks[taskName].processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
            }

            tasks[taskName].statusDiv.textContent = 'Image uploaded. Ready to process.';
            checkIfReady();
            tasks[taskName].discriminant1Rect = null;
            tasks[taskName].discriminant2Rect = null;
            tasks[taskName].ocrRect = null;
            tasks[taskName].identifiedCompletedTaskIds.clear(); // Clear identified task IDs on new upload


             if (tasks[taskName].outputArea) {
                 tasks[taskName].outputArea.value = '';
                 // Output area visibility based on IS_DEV_MODE is handled after processing
             } else {
                 console.error(`Error: task.outputArea is undefined for task ${taskName} during file upload.`);
             }
             // Clear and hide wiki links on new image upload
             if (tasks[taskName].wikiLinksDiv) {
                 tasks[taskName].wikiLinksDiv.innerHTML = '';
             }
              // Clear and hide required tasks on new image upload
             if (tasks[taskName].requiredTasksDiv) {
                 tasks[taskName].requiredTasksDiv.innerHTML = '';
             }
             // Collapse content sections on new image upload
             if (tasks[taskName].outputContent) {
                 tasks[taskName].outputContent.classList.remove('active');
                 tasks[taskName].outputHeader.classList.remove('active');
             }
             if (tasks[taskName].wikiContent) {
                 tasks[taskName].wikiContent.classList.remove('active');
                 tasks[taskName].wikiHeader.classList.remove('active');
             }
             if (tasks[taskName].requiredTasksContent) {
                 tasks[taskName].requiredTasksContent.classList.remove('active');
                 tasks[taskName].requiredTasksHeader.classList.remove('active');
             }
        });
    });

    // Add click listeners to collapsible headers
    if (tasks[taskName].outputHeader && tasks[taskName].outputContent) {
        tasks[taskName].outputHeader.addEventListener('click', () => {
            tasks[taskName].outputContent.classList.toggle('active');
            tasks[taskName].outputHeader.classList.toggle('active');
        });
    }
     if (tasks[taskName].wikiHeader && tasks[taskName].wikiContent) {
        tasks[taskName].wikiHeader.addEventListener('click', () => {
            tasks[taskName].wikiContent.classList.toggle('active');
            tasks[taskName].wikiHeader.classList.toggle('active');
        });
    }
     if (tasks[taskName].requiredTasksHeader && tasks[taskName].requiredTasksContent) {
        tasks[taskName].requiredTasksHeader.addEventListener('click', () => {
            tasks[taskName].requiredTasksContent.classList.toggle('active');
            tasks[taskName].requiredTasksHeader.classList.toggle('active');
        });
    }
});

function drawTaskImageOnCanvas(taskName) {
     const task = tasks[taskName];
     if (!task.image || !task.originalCanvas || !task.originalCtx) return;

     const { width, height } = task.image;
     const ctx = task.originalCtx;

     ctx.canvas.width = width;
     ctx.canvas.height = height;

     ctx.clearRect(0, 0, width, height);
     ctx.drawImage(task.image, 0, 0, width, height);

     if (task.ocrRect) {
         ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';

         if (task.ocrRect.left > 0) {
             ctx.fillRect(0, 0, task.ocrRect.left, height);
         }
         if (task.ocrRect.top > 0) {
              ctx.fillRect(0, 0, width, task.ocrRect.top);
         }

         const ocrRight = task.ocrRect.left + task.ocrRect.width;
         if (ocrRight < width) {
              ctx.fillRect(ocrRight, 0, width - ocrRight, height);
         }
         // Draw red overlay below the OCR region (the ignored bottom 10%)
         const ocrBottom = task.ocrRect.top + task.ocrRect.height;
         if (ocrBottom < height) { // Check if there's space below the OCR rect
              ctx.fillRect(0, ocrBottom, width, height - ocrBottom);
         }
     }

     if (task.discriminant1Rect) {
         drawRect(ctx, task.discriminant1Rect, 'rgba(0, 255, 0, 1.0)', 2);
     }
     if (task.discriminant2Rect) {
         drawRect(ctx, task.discriminant2Rect, 'rgba(0, 0, 255, 1.0)', 2);
     }
     if (task.ocrRect) {
          drawRect(ctx, task.ocrRect, 'rgba(255, 255, 0, 1.0)', 2);
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

// --- Task Tree Building ---
function buildTaskTree(tasksData) {
    const tree = {}; // Map task ID to its object and requirements

    // Populate the tree with all tasks
    tasksData.forEach(task => {
        tree[task.id] = {
            ...task, // Copy task properties
            requiredBy: [] // Add a list to store tasks that require this one
        };
    });

    // Link tasks to their requirements and build the 'requiredBy' list
    tasksData.forEach(task => {
        if (task.taskRequirements && task.taskRequirements.length > 0) {
            task.taskRequirements.forEach(req => {
                if (req.task && tree[req.task.id]) {
                     // Add this task to the 'requiredBy' list of its prerequisite
                    if (!tree[req.task.id].requiredBy.some(t => t.id === task.id)) {
                         tree[req.task.id].requiredBy.push({ id: task.id, name: task.name });
                    }
                }
            });
        }
    });

    return tree;
}

// --- Get Required Completed Tasks ---
function getRequiredCompletedTasks(identifiedTaskIds, taskTree) {
    const requiredTasks = new Set();
    const visited = new Set(); // To prevent infinite loops in case of circular dependencies

    function traverseRequirements(taskId) {
        if (visited.has(taskId)) {
            return; // Already visited this task
        }
        visited.add(taskId);

        const task = taskTree[taskId];
        if (!task) {
            return; // Task not found in the tree
        }

        if (task.taskRequirements && task.taskRequirements.length > 0) {
            task.taskRequirements.forEach(req => {
                if (req.task && taskTree[req.task.id]) {
                    requiredTasks.add(req.task.id); // Add the prerequisite to the set
                    traverseRequirements(req.task.id); // Recursively traverse its requirements
                }
            });
        }
    }

    // Start traversal from each identified task
    identifiedTaskIds.forEach(taskId => {
        traverseRequirements(taskId);
    });

    // Convert the set of required task IDs back to task objects
    const completedTasksList = Array.from(requiredTasks)
        .map(taskId => taskTree[taskId])
        .filter(task => task !== undefined); // Filter out any potential undefined entries

    return completedTasksList;
}


async function fetchTarkovTasks() {
    globalStatusDiv.textContent = 'Fetching task data...'; // Keep this message
    const query = `
        {
            tasks(lang: en) {
                name
                id # Fetch task ID
                taskRequirements {
                    task {
                        name
                        id # Fetch prerequisite task ID
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

    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : ''; // Get API key from input

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    };

    if (apiKey) {
        headers['x-api-key'] = apiKey; // Add API key to headers if present
    }

    try {
        const response = await fetch('https://api.tarkov.dev/graphql', {
            method: 'POST',
            headers: headers, // Use the headers object
            body: JSON.stringify({ query })
        });

        const data = await response.json();

        if (data.errors) {
            console.error('GraphQL errors:', data.errors);
            globalStatusDiv.textContent = 'Error fetching task data. Check console.'; // Keep this error message
            return null;
        }

        tarkovTasksData = data.data.tasks;
        console.log('Tarkov task data fetched:', tarkovTasksData);

        // Initialize Fuse.js with the fetched task data
        // Note: We initialize Fuse with ALL tasks here, filtering by trader is done in matchOcrLineToTask
        fuse = new Fuse(tarkovTasksData, {
             keys: ['name'], // Search in the 'name' property of task objects
             includeScore: true, // Include the matching score in the results
             threshold: 0.4, // Adjust this threshold (0 is perfect match, 1 is no match)
             ignoreLocation: true, // Don't penalize matches based on location in the string
             distance: 100, // Consider matches up to this distance (in characters)
             isCaseSensitive: false, // Case-insensitive matching
             findAllMatches: false, // Only find the best match
             minMatchCharLength: 3 // Minimum number of characters to match
        });
        console.log('Fuse.js initialized with Tarkov task data.');


        // Build the task tree after fetching data
        taskTree = buildTaskTree(tarkovTasksData);
        console.log('Task tree built:', taskTree);

        checkIfReady(); // Check if button should be enabled after data is loaded
        return tarkovTasksData;

    } catch (error) {
        console.error('Error fetching Tarkov task data:', error);
        globalStatusDiv.textContent = 'Error fetching task data. Check console.'; // Keep this error message
        return null;
    }
}

function checkIfReady() {
    const anyTaskImageUploaded = taskNames.some(taskName => tasks[taskName].image !== null);
    const anyTaskMatched = taskNames.some(taskName => tasks[taskName].identifiedCompletedTaskIds.size > 0);
    const apiKeyPresent = apiKeyInput && apiKeyInput.value.trim() !== '';

    // Enable Process All button if Tarkov data is loaded AND at least one image is uploaded AND fuse is initialized
    if (tarkovTasksData.length > 0 && anyTaskImageUploaded && fuse) {
        processAllButton.disabled = false;
        globalStatusDiv.textContent = 'Task data loaded. Upload images and click "Process All" to begin.'; // Simplified ready message
    } else if (tarkovTasksData.length > 0 && fuse) {
         // If data and fuse are loaded but no images yet
         globalStatusDiv.textContent = 'Task data loaded. Upload task images to enable processing.';
         processAllButton.disabled = true;
    } else {
         // If data or fuse are not yet loaded
         processAllButton.disabled = true;
         globalStatusDiv.textContent = 'Loading dependencies...'; // Simplified loading message
    }

    // Enable Post Completed Tasks button if any task is matched AND API key is present
    if (anyTaskMatched && apiKeyPresent) {
        postCompletedTasksButton.disabled = false;
    } else {
        postCompletedTasksButton.disabled = true;
    }
}

processAllButton.addEventListener('click', async () => {
     cv = (cv instanceof Promise) ? await cv : cv;

     if (!discriminantImage1 || !discriminantImage2 || tarkovTasksData.length === 0 || Object.keys(taskTree).length === 0 || !fuse) {
         globalStatusDiv.textContent = 'Error: Dependencies not loaded.';
         return;
     }

     processAllButton.disabled = true;
     postCompletedTasksButton.disabled = true; // Disable post button during processing
     globalStatusDiv.textContent = 'Starting processing...'; // Simplified message

     const processingPromises = taskNames.map(async taskName => {
         const task = tasks[taskName];
         task.identifiedCompletedTaskIds.clear(); // Clear previous identified tasks


         if (!task.image && taskName !== "Ref") {
             task.statusDiv.textContent = 'No image uploaded. Skipping.';
             if (task.outputArea) {
                 task.outputArea.value = '';
             }
             // Ensure content sections are collapsed and cleared if skipping
             if (task.outputContent) task.outputContent.classList.remove('active');
             if (task.outputHeader) task.outputHeader.classList.remove('active');
             if (task.wikiLinksDiv) task.wikiLinksDiv.innerHTML = '';
             if (task.wikiContent) task.wikiContent.classList.remove('active');
             if (task.wikiHeader) task.wikiHeader.classList.remove('active');
              if (task.requiredTasksDiv) task.requiredTasksDiv.innerHTML = '';
             if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
             if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
             if (task.originalCanvas) task.originalCanvas.style.display = 'none';
             if (task.processedCanvas) task.processedCanvas.style.display = 'none';
             return;
         }

        if (taskName === "Ref" && !task.image) {
            if (task.outputArea) {
                task.outputArea.value = 'No Ref image provided.';
            }
            // Ensure content sections are collapsed and cleared if skipping
            if (task.outputContent) task.outputContent.classList.remove('active'); // Keep collapsed
            if (task.outputHeader) task.outputHeader.classList.remove('active'); // Keep collapsed
            if (task.wikiLinksDiv) task.wikiLinksDiv.innerHTML = '';
            if (task.wikiContent) task.wikiContent.classList.remove('active');
            if (task.wikiHeader) task.wikiHeader.classList.remove('active');
             if (task.requiredTasksDiv) task.requiredTasksDiv.innerHTML = '';
            if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
            if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
            task.statusDiv.textContent = 'Processing skipped (no image).';
             if (task.originalCanvas) task.originalCanvas.style.display = 'none';
             if (task.processedCanvas) task.processedCanvas.style.display = 'none';
            return;
        }

         if (task.outputArea) {
             task.outputArea.value = '';
         } else {
              console.error(`Error: task.outputArea is undefined for task ${taskName} during processing setup.`);
              task.statusDiv.textContent = `Error: Output area not found for ${taskName}.`;
              return;
         }

         if (task.wikiLinksDiv) {
             task.wikiLinksDiv.innerHTML = '';
         }
          if (task.requiredTasksDiv) {
             task.requiredTasksDiv.innerHTML = '';
         }
         // Ensure content sections are collapsed at the start of processing
         if (task.outputContent) task.outputContent.classList.remove('active');
         if (task.outputHeader) task.outputHeader.classList.remove('active');
         if (task.wikiContent) task.wikiContent.classList.remove('active');
         if (task.wikiHeader) task.wikiHeader.classList.remove('active');
         if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
         if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');


         task.statusDiv.textContent = `Processing ${taskName}...`;

         try {
             let src = cv.imread(task.image);
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

             const searchRect = new cv.Rect(0, 0, task.image.width / 2, task.image.height);

             searchRect.width = Math.max(0, Math.min(searchRect.width, task.image.width));
             searchRect.height = Math.max(0, Math.min(searchRect.height, task.image.height));
             searchRect.x = Math.max(0, searchRect.x);
             searchRect.y = Math.max(0, searchRect.y);

             let srcRoi = null;
             if (searchRect.width > 0 && searchRect.height > 0) {
                  srcRoi = src.roi(searchRect);
             } else {
                  console.error(`Search area for discriminants in ${taskName} is invalid.`);
                  task.statusDiv.textContent = 'Search area for discriminants is invalid.';
                  if (task.outputArea) task.outputArea.value = 'Could not define a valid search area for the discriminants.';
                  src.delete();
                  templ1.delete();
                  templ2.delete();
                  dst1.delete();
                  dst2.delete();
                  if (task.originalCanvas) task.originalCanvas.style.display = 'none';
                  if (task.processedCanvas) task.processedCanvas.style.display = 'none';
                  if (task.outputContent) task.outputContent.classList.remove('active');
                  if (task.outputHeader) task.outputHeader.classList.remove('active');
                  if (task.wikiContent) task.wikiContent.classList.remove('active');
                  if (task.wikiHeader) task.wikiHeader.classList.remove('active');
                   if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
                  if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
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

             task.discriminant1Rect = null;
             task.discriminant2Rect = null;
             task.ocrRect = null;

             let discriminantsFound = 0;

             if (matchLoc1.x >= 0 && matchLoc1.y >= 0 && matchLoc1.x < searchRect.width && matchLoc1.y < searchRect.height) {
                  task.discriminant1Rect = {
                      left: matchLoc1.x + searchRect.x,
                      top: matchLoc1.y + searchRect.y,
                      width: discriminantImage1.width,
                      height: discriminantImage1.height
                  };
                  discriminantsFound++;
             }

             if (matchLoc2.x >= 0 && matchLoc2.y >= 0 && matchLoc2.x < searchRect.width && matchLoc2.y < searchRect.height) {
                  task.discriminant2Rect = {
                      left: matchLoc2.x + searchRect.x,
                      top: matchLoc2.y + searchRect.y,
                      width: discriminantImage2.width,
                      height: discriminantImage2.height
                  };
                   discriminantsFound++;
             }

             if (task.discriminant1Rect) {
                 task.discriminant1Rect.width = Math.max(0, Math.min(task.discriminant1Rect.width, task.image.width - task.discriminant1Rect.left));
                 task.discriminant1Rect.height = Math.max(0, Math.min(task.discriminant1Rect.height, task.image.height - task.discriminant1Rect.top));
                 task.discriminant1Rect.left = Math.max(0, task.discriminant1Rect.left);
                 task.discriminant1Rect.top = Math.max(0, task.discriminant1Rect.top);
             }
             if (task.discriminant2Rect) {
                 task.discriminant2Rect.width = Math.max(0, Math.min(task.discriminant2Rect.width, task.image.width - task.discriminant2Rect.left));
                 task.discriminant2Rect.height = Math.max(0, Math.min(task.discriminant2Rect.height, task.image.height - task.discriminant2Rect.top));
                 task.discriminant2Rect.left = Math.max(0, task.discriminant2Rect.left);
                 task.discriminant2Rect.top = Math.max(0, task.discriminant2Rect.top);
             }

             if (discriminantsFound > 0) {
                 task.statusDiv.textContent = `${taskName}: Discriminants found. Defining OCR region...`; // Simplified message

                 let leftmostDiscriminant = null;
                 let rightmostDiscriminant = null;
                 let lowerDiscriminant = null;

                 if (task.discriminant1Rect && task.discriminant2Rect) {
                     leftmostDiscriminant = task.discriminant1Rect.left < task.discriminant2Rect.left ? task.discriminant1Rect : task.discriminant2Rect;
                     rightmostDiscriminant = task.discriminant1Rect.left > task.discriminant2Rect.left ? task.discriminant1Rect : task.discriminant2Rect;
                     lowerDiscriminant = task.discriminant1Rect.top > task.discriminant2Rect.top ? task.discriminant1Rect : task.discriminant2Rect;
                 } else if (task.discriminant1Rect) {
                     leftmostDiscriminant = task.discriminant1Rect;
                     rightmostDiscriminant = task.discriminant1Rect;
                     lowerDiscriminant = task.discriminant1Rect;
                 } else if (task.discriminant2Rect) {
                      leftmostDiscriminant = task.discriminant2Rect;
                      rightmostDiscriminant = task.discriminant2Rect;
                      lowerDiscriminant = task.discriminant2Rect;
                 }

                 // Define the bottom boundary for OCR as 90% of the image height
                 const ocrBottom = task.image.height * 0.9;

                 if (leftmostDiscriminant && rightmostDiscriminant && lowerDiscriminant) {
                      task.ocrRect = {
                          left: leftmostDiscriminant.left + leftmostDiscriminant.width,
                          top: lowerDiscriminant.top,
                          width: rightmostDiscriminant.left - (leftmostDiscriminant.left + leftmostDiscriminant.width),
                          // Calculate height from the top of the lower discriminant to the 90% mark
                          height: ocrBottom - lowerDiscriminant.top
                      };
                 } else {
                      task.ocrRect = { left: 0, top: 0, width: 0, height: 0 };
                      console.error(`Could not determine leftmost/rightmost/lower discriminant for ${taskName}.`);
                 }

                 task.ocrRect.width = Math.max(0, task.ocrRect.width);
                 task.ocrRect.height = Math.max(0, task.ocrRect.height);
                 task.ocrRect.left = Math.max(0, task.ocrRect.left);
                 task.ocrRect.top = Math.max(0, task.ocrRect.top);

                 // Ensure OCR region doesn't go below the 90% mark
                 if (task.ocrRect.top + task.ocrRect.height > ocrBottom) {
                     task.ocrRect.height = ocrBottom - task.ocrRect.top;
                 }
                  // Ensure height is not negative
                 task.ocrRect.height = Math.max(0, task.ocrRect.height);


                 drawTaskImageOnCanvas(taskName);

                 if (task.ocrRect.width > 0 && task.ocrRect.height > 0) {
                      const tempProcessedCanvas = document.createElement('canvas');
                      tempProcessedCanvas.width = task.ocrRect.width;
                      tempProcessedCanvas.height = task.ocrRect.height;
                      const tempProcessedCtx = tempProcessedCanvas.getContext('2d');

                      tempProcessedCtx.drawImage(
                          task.image,
                          task.ocrRect.left,
                          task.ocrRect.top,
                          task.ocrRect.width,
                          task.ocrRect.height,
                          0, 0,
                          task.ocrRect.width,
                          task.ocrRect.height
                      );

                      // Get image data from the drawn region
                      const imageData = tempProcessedCtx.getImageData(0, 0, tempProcessedCanvas.width, tempProcessedCanvas.height);
                      const pixels = imageData.data;
                      const ocrWidth = tempProcessedCanvas.width;
                      const ocrHeight = tempProcessedCanvas.height;

                      const brightnessChangeThreshold = 20;
                      const binarizationThreshold = 120;

                      let currentBlockStartRow = 0;
                      let previousLeftmostBrightness = -1;

                      // Apply block-based inversion and binarization
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

                          if (brightnessDifference > brightnessChangeThreshold || y === ocrHeight - 1) {
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

                                          if (brightness < binarizationThreshold) {
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

                               if (y === ocrHeight - 1 && brightnessDifference <= brightnessChangeThreshold) {
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
                                                   if (brightness < binarizationThreshold) {
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

                      // Put processed image data back onto the temporary canvas
                      tempProcessedCtx.putImageData(imageData, 0, 0);

                      task.processedCanvas.width = tempProcessedCanvas.width;
                      task.processedCanvas.height = tempProcessedCanvas.height;
                      task.processedCtx.clearRect(0, 0, task.processedCanvas.width, task.processedCanvas.height);
                      task.processedCtx.drawImage(tempProcessedCanvas, 0, 0);

                       if (task.processedCanvas) {
                           task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
                       }

                      task.statusDiv.textContent = `${taskName}: Image processing complete. Starting OCR...`; // Simplified message

                       if (task.processedCanvas) {
                           let worker = await Tesseract.createWorker('eng', 1, {
                                logger: m => {
                                   if (m.status === 'recognizing') {
                                       task.statusDiv.textContent = `Extracting text: ${taskName}: ${Math.round(m.progress * 100)}%`;
                                   } else {
                                       task.statusDiv.textContent = `OCR: ${taskName}: ${m.status}`;
                                    }
                                }
                           });

                           worker.setParameters({
                               tessedit_char_whitelist: ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-',
                               tessedit_pageseg_mode: Tesseract.PSM.AUTO
                           });

                           const result = await worker.recognize(tempProcessedCanvas);
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
                            // identifiedTaskIds is now stored per task container
                            const currentIdentifiedTaskIds = new Set();

                            extractedLines.forEach(line => {
                                // Use the new fuzzy matching function
                                const matchedTask = matchOcrLineToTask(line, tarkovTasksData, taskName);
                                if (matchedTask) {
                                    matchedResults.push({
                                        ocrLine: line.trim(),
                                        task: matchedTask.task,
                                        score: matchedTask.score // Fuse.js score is lower for better matches
                                    });
                                    currentIdentifiedTaskIds.add(matchedTask.task.id); // Add matched task ID
                                } else {
                                     if (IS_DEV_MODE) {
                                         matchedResults.push({
                                             ocrLine: line.trim(),
                                             task: null,
                                             score: null // No score if no match
                                         });
                                     }
                                }
                            });

                            // Store the identified completed task IDs for this container
                            task.identifiedCompletedTaskIds = currentIdentifiedTaskIds;


                           if (task.outputArea) {
                               let output = '';
                               let wikiLinksHtml = '';

                               if (IS_DEV_MODE) {
                                   output += '--- OCR Line Matches (Dev Mode) ---\n';
                                   matchedResults.forEach(result => {
                                       if (result.task) {
                                           output += `"${result.ocrLine}" => "${result.task.name}" (Trader: ${result.task.trader.name}, Fuse Score: ${result.score.toFixed(4)})\n`; // Display Fuse score
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
                                        // Message when no tasks are matched in non-dev mode
                                        output += 'No tasks matched any OCR line for this trader.';
                                    }
                               }

                               task.outputArea.value = output;
                               // Do NOT automatically expand output or wiki links after processing
                               // Visibility is now controlled solely by the collapsible headers' active class
                               // The headers are collapsed by default via CSS and on new image upload/processing start.


                               if (task.wikiLinksDiv) {
                                   if (wikiLinksHtml) {
                                       task.wikiLinksDiv.innerHTML = '<h4>Wiki Links:</h4><ul>' + wikiLinksHtml + '</ul>';
                                       // Do NOT automatically expand wiki links after processing
                                   } else {
                                        task.wikiLinksDiv.innerHTML = '';
                                        // Hide and collapse wiki links if none were found
                                        if (task.wikiContent) task.wikiContent.classList.remove('active');
                                        if (task.wikiHeader) task.wikiHeader.classList.remove('active');
                                   }
                               }

                               // --- Identify and Display Required Completed Tasks ---
                               if (task.requiredTasksDiv && Object.keys(taskTree).length > 0) {
                                    const requiredCompletedTasks = getRequiredCompletedTasks(Array.from(task.identifiedCompletedTaskIds), taskTree); // Use identifiedCompletedTaskIds for this container

                                    let requiredTasksHtml = '';
                                    if (requiredCompletedTasks.length > 0) {
                                        requiredTasksHtml += '<h4>Required Completed Tasks:</h4><ul>';
                                        // Sort tasks alphabetically by name before displaying
                                        requiredCompletedTasks.sort((a, b) => a.name.localeCompare(b.name));
                                        requiredCompletedTasks.forEach(reqTask => {
                                             requiredTasksHtml += `<li>${reqTask.name} (${reqTask.id})</li>`;
                                        });
                                        requiredTasksHtml += '</ul>';
                                    } else {
                                         requiredTasksHtml = 'No specific prerequisite tasks identified based on OCR results.';
                                    }
                                    task.requiredTasksDiv.innerHTML = requiredTasksHtml;

                                    // Only show and potentially expand the required tasks section if there is content
                                    if (requiredTasksHtml.trim().length > 0 && requiredTasksHtml !== 'No specific prerequisite tasks identified based on OCR results.') {
                                         // Do NOT automatically expand required tasks after processing
                                    } else {
                                         if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
                                         if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
                                    }
                               } else if (task.requiredTasksDiv) {
                                    task.requiredTasksDiv.innerHTML = 'Task dependency data not available.';
                                     if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
                                     if (task.requiredTasksHeader) task.wikiHeader.classList.remove('active');
                               }


                           } else {
                                console.error(`Error: task.outputArea is undefined for task ${taskName} during output display.`);
                           }

                           task.statusDiv.textContent = `Processing complete for ${taskName}.`; // Simplified message


                       } else {
                            if (task.outputArea) {
                                task.outputArea.value = 'Failed to prepare image for OCR.';
                            } else {
                                console.error(`Error: task.outputArea is undefined for task ${taskName} during OCR preparation failure.`);
                            }
                            task.statusDiv.textContent = 'Failed to prepare image for OCR.';
                             if (task.outputContent) task.outputContent.classList.remove('active');
                             if (task.outputHeader) task.outputHeader.classList.remove('active');
                             if (task.wikiContent) task.wikiContent.classList.remove('active');
                             if (task.wikiHeader) task.wikiHeader.classList.remove('active');
                              if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
                             if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
                       }
                 } else {
                     if (task.outputArea) {
                         task.outputArea.value = 'Calculated OCR region is invalid (zero width or height).';
                     } else {
                          console.error(`Error: task.outputArea is undefined for task ${taskName} during invalid OCR region.`);
                     }
                     task.statusDiv.textContent = 'OCR region invalid.';
                     if (task.processedCanvas) task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none'; // Ensure processed canvas display is set based on IS_DEV_MODE
                     if (task.outputContent) task.outputContent.classList.remove('active');
                     if (task.outputHeader) task.outputHeader.classList.remove('active');
                     if (task.wikiContent) task.wikiContent.classList.remove('active');
                     if (task.wikiHeader) task.wikiHeader.classList.remove('active');
                      if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
                     if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
                 }


             } else {
                 task.discriminant1Rect = null;
                 task.discriminant2Rect = null;
                 task.ocrRect = null;
                 if (task.outputArea) {
                     task.outputArea.value = 'One or both discriminant shapes not found.'; // Simplified message
                 } else {
                     console.error(`Error: task.outputArea is undefined for task ${taskName} when discriminants not found.`);
                 }
                 task.statusDiv.textContent = 'Discriminants not found.'; // Simplified message
                  drawTaskImageOnCanvas(taskName);
                  if (task.processedCanvas) task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none'; // Ensure processed canvas display is set based on IS_DEV_MODE
                  if (task.outputContent) task.outputContent.classList.remove('active');
                  if (task.outputHeader) task.outputHeader.classList.remove('active');
                  if (task.wikiContent) task.wikiContent.classList.remove('active');
                  if (task.wikiHeader) task.wikiHeader.classList.remove('active');
                  if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
                  if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
             }
         } catch (error) {
             console.error(`Error processing ${taskName}:`, error);
             task.statusDiv.textContent = `Error processing ${taskName}. Check console.` ;
             if (task.outputArea) {
                 task.outputArea.value = `Error: ${error.message}`;
             } else {
                  console.error(`Error: task.outputArea is undefined for task ${taskName} during general error handling.`);
             }
              if (task.processedCanvas) task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none'; // Ensure processed canvas display is set based on IS_DEV_MODE
              if (task.outputContent) task.outputContent.classList.remove('active');
              if (task.outputHeader) task.outputHeader.classList.remove('active');
              if (task.wikiContent) task.wikiContent.classList.remove('active');
              if (task.wikiHeader) task.wikiHeader.classList.remove('active');
               if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
              if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
         }
     });

     await Promise.all(processingPromises);

     globalStatusDiv.textContent = 'Processing complete.'; // Simplified message
     checkIfReady(); // Re-check button states after processing
});

// --- Post Completed Tasks Functionality ---
postCompletedTasksButton.addEventListener('click', async () => {
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';

    if (!apiKey) {
        globalStatusDiv.textContent = 'Please enter your TarkovTracker API key.';
        return;
    }

    postCompletedTasksButton.disabled = true;
    globalStatusDiv.textContent = 'Posting completed tasks to TarkovTracker...';

    let tasksPostedCount = 0;
    let tasksFailedCount = 0;

    for (const taskName of taskNames) {
        const task = tasks[taskName];
        if (task.identifiedCompletedTaskIds && task.identifiedCompletedTaskIds.size > 0) {
            for (const taskId of task.identifiedCompletedTaskIds) {
                const postUrl = `https://tarkovtracker.io/api/v2/progress/task/${taskId}`;
                const headers = {
                    'accept': '*/*',
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                };
                const body = JSON.stringify({ "state": "completed" });

                try {
                    const response = await fetch(postUrl, {
                        method: 'POST',
                        headers: headers,
                        body: body
                    });

                    if (response.ok) {
                        console.log(`Successfully posted task ${taskId} as completed.`);
                        tasksPostedCount++;
                        // Optionally update the task's status div or output area
                         if (task.outputArea) {
                             task.outputArea.value += `\nPosted task ${taskId} as completed to TarkovTracker.`;
                         }
                    } else {
                        const errorText = await response.text();
                        console.error(`Failed to post task ${taskId}. Status: ${response.status}. Response: ${errorText}`);
                        tasksFailedCount++;
                         if (task.outputArea) {
                             task.outputArea.value += `\nFailed to post task ${taskId}. Status: ${response.status}.`;
                         }
                    }
                } catch (error) {
                    console.error(`Error during fetch for task ${taskId}:`, error);
                    tasksFailedCount++;
                     if (task.outputArea) {
                         task.outputArea.value += `\nError posting task ${taskId}: ${error.message}`;
                     }
                }
            }
        }
    }

    globalStatusDiv.textContent = `Posting complete. Successfully posted ${tasksPostedCount} tasks, failed to post ${tasksFailedCount} tasks.`;
    checkIfReady(); // Re-enable buttons
});
// --- End Post Completed Tasks Functionality ---


globalStatusDiv.textContent = 'Loading dependencies...'; // Initial simplified message

const loadOpenCv = new Promise((resolve) => {
    if (typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined') {
        console.log('OpenCV.js already initialized.');
        resolve();
    } else {
        cv.onRuntimeInitialized = () => {
            console.log('OpenCV.js runtime initialized.');
            resolve();
        };
    }
});

// Load Fuse.js and then other dependencies
const loadFuse = new Promise((resolve) => {
    // Check if Fuse is already loaded (e.g., from a previous run)
    if (typeof Fuse !== 'undefined') {
        console.log('Fuse.js already loaded.');
        resolve();
    } else {
        // If not, wait for the script tag to load it (handled in index.html)
        // We can't directly add the script tag here and wait for it easily
        // A simpler approach is to assume the script tag in index.html loads it
        // and check for its existence after a short delay or rely on the fetchTarkovTasks
        // which is part of the overall dependency loading.
        // For simplicity, we'll rely on the overall Promise.all and the check in fetchTarkovTasks.
        // A more robust approach would involve dynamically creating the script tag here and
        // listening for its 'load' event. However, given the context, relying on the HTML
        // loading is acceptable.
         console.log('Waiting for Fuse.js to load from HTML.');
         // We don't have a direct way to listen for the script tag load here,
         // so we'll just resolve immediately and rely on the check in fetchTarkovTasks
         // and checkIfReady that Fuse is initialized.
         resolve();
    }
});


Promise.all([
     loadOpenCv,
     loadFuse, // Wait for the promise indicating Fuse.js is potentially loaded
     fetchTarkovTasks(), // Fetch Tarkov data (Fuse.js will be initialized inside this)
     new Promise((resolve) => {
         // Load the first discriminant image
         loadImageFromUrl(DISCRIMINANT_IMAGE_PATHS[0], (img) => {
             discriminantImage1 = img;
             resolve();
         });
     }),
     new Promise((resolve) => {
          // Load the second discriminant image
          loadImageFromUrl(DISCRIMINANT_IMAGE_PATHS[1], (img) => {
              discriminantImage2 = img;
              resolve();
          });
     })
]).then(() => {
     // Removed status message here, handled by checkIfReady
     checkIfReady(); // Check if Process All button should be enabled after all dependencies are loaded
}).catch(error => {
     console.error("Error loading dependencies:", error);
     globalStatusDiv.textContent = 'Error loading dependencies. Check console for details.';
});


 // Initial state: Hide canvases and output areas, and collapse collapsible sections
 taskNames.forEach(taskName => {
     const task = tasks[taskName];
     if (task.originalCanvas) task.originalCanvas.style.display = 'none';
     if (task.processedCanvas) task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none'; // Set initial display based on IS_DEV_MODE
     if (task.outputArea) task.outputArea.value = ''; // Clear any default text
     if (task.wikiLinksDiv) task.wikiLinksDiv.innerHTML = ''; // Clear any default content
      if (task.requiredTasksDiv) task.requiredTasksDiv.innerHTML = ''; // Clear any default content

     // Ensure collapsible sections are collapsed initially
     if (task.outputContent) task.outputContent.classList.remove('active');
     if (task.outputHeader) task.outputHeader.classList.remove('active');
     if (task.wikiContent) task.wikiContent.classList.remove('active');
     if (task.wikiHeader) task.wikiHeader.classList.remove('active');
      if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
     if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
 });
