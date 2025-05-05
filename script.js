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
        threshold: 0.4,
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


function createTaskHtml(taskName) {
    return `
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
        outputHeader: null,
        outputContent: null,
        wikiHeader: null,
        wikiContent: null,
        requiredTasksDiv: null,
        requiredTasksHeader: null,
        requiredTasksContent: null,
        identifiedCompletedTaskIds: new Set()
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
            tasks[taskName].identifiedCompletedTaskIds.clear();


             if (tasks[taskName].outputArea) {
                 tasks[taskName].outputArea.value = '';
             } else {
                 console.error(`Error: task.outputArea is undefined for task ${taskName} during file upload.`);
             }
             if (tasks[taskName].wikiLinksDiv) {
                 tasks[taskName].wikiLinksDiv.innerHTML = '';
             }
              if (tasks[taskName].requiredTasksDiv) {
                 tasks[taskName].requiredTasksDiv.innerHTML = '';
             }
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
         const ocrBottom = task.ocrRect.top + task.ocrRect.height;
         if (ocrBottom < height) {
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
             threshold: 0.4,
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
    const anyTaskImageUploaded = taskNames.some(taskName => tasks[taskName].image !== null);
    const anyTaskMatched = taskNames.some(taskName => tasks[taskName].identifiedCompletedTaskIds.size > 0);
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
     postCompletedTasksButton.disabled = true;
     globalStatusDiv.textContent = 'Starting processing...';

     const processingPromises = taskNames.map(async taskName => {
         const task = tasks[taskName];
         task.identifiedCompletedTaskIds.clear();


         if (!task.image && taskName !== "Ref") {
             task.statusDiv.textContent = 'No image uploaded. Skipping.';
             if (task.outputArea) {
                 task.outputArea.value = '';
             }
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
            if (task.outputContent) task.outputContent.classList.remove('active');
            if (task.outputHeader) task.outputHeader.classList.remove('active');
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
                 task.statusDiv.textContent = `${taskName}: Discriminants found. Defining OCR region...`;

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

                 const ocrBottom = task.image.height * 0.9;

                 if (leftmostDiscriminant && rightmostDiscriminant && lowerDiscriminant) {
                      task.ocrRect = {
                          left: leftmostDiscriminant.left + leftmostDiscriminant.width,
                          top: lowerDiscriminant.top,
                          width: rightmostDiscriminant.left - (leftmostDiscriminant.left + leftmostDiscriminant.width),
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

                 if (task.ocrRect.top + task.ocrRect.height > ocrBottom) {
                     task.ocrRect.height = ocrBottom - task.ocrRect.top;
                 }
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

                      const imageData = tempProcessedCtx.getImageData(0, 0, tempProcessedCanvas.width, tempProcessedCanvas.height);
                      const pixels = imageData.data;
                      const ocrWidth = tempProcessedCanvas.width;
                      const ocrHeight = tempProcessedCanvas.height;

                      const brightnessChangeThreshold = 20;
                      const binarizationThreshold = 120;

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

                      tempProcessedCtx.putImageData(imageData, 0, 0);

                      task.processedCanvas.width = tempProcessedCanvas.width;
                      task.processedCanvas.height = tempProcessedCanvas.height;
                      task.processedCtx.clearRect(0, 0, task.processedCanvas.width, task.processedCanvas.height);
                      task.processedCtx.drawImage(tempProcessedCanvas, 0, 0);

                       if (task.processedCanvas) {
                           task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
                       }

                      task.statusDiv.textContent = `${taskName}: Image processing complete. Starting OCR...`;

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
                            const currentIdentifiedTaskIds = new Set();

                            extractedLines.forEach(line => {
                                const matchedTask = matchOcrLineToTask(line, tarkovTasksData, taskName);
                                if (matchedTask) {
                                    matchedResults.push({
                                        ocrLine: line.trim(),
                                        task: matchedTask.task,
                                        score: matchedTask.score
                                    });
                                    currentIdentifiedTaskIds.add(matchedTask.task.id);
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

                            task.identifiedCompletedTaskIds = currentIdentifiedTaskIds;


                           if (task.outputArea) {
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

                               task.outputArea.value = output;


                               if (task.wikiLinksDiv) {
                                   if (wikiLinksHtml) {
                                       task.wikiLinksDiv.innerHTML = '<h4>Wiki Links:</h4><ul>' + wikiLinksHtml + '</ul>';
                                   } else {
                                        task.wikiLinksDiv.innerHTML = '';
                                        if (task.wikiContent) task.wikiContent.classList.remove('active');
                                        if (task.wikiHeader) task.wikiHeader.classList.remove('active');
                                   }
                               }

                               if (task.requiredTasksDiv && Object.keys(taskTree).length > 0) {
                                    const requiredCompletedTasks = getRequiredCompletedTasks(Array.from(task.identifiedCompletedTaskIds), taskTree);

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
                                    task.requiredTasksDiv.innerHTML = requiredTasksHtml;

                                    if (requiredTasksHtml.trim().length > 0 && requiredTasksHtml !== 'No specific prerequisite tasks identified based on OCR results.') {
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

                           task.statusDiv.textContent = `Processing complete for ${taskName}.`;


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
                     if (task.processedCanvas) task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
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
                     task.outputArea.value = 'One or both discriminant shapes not found.';
                 } else {
                     console.error(`Error: task.outputArea is undefined for task ${taskName} when discriminants not found.`);
                 }
                 task.statusDiv.textContent = 'Discriminants not found.';
                  drawTaskImageOnCanvas(taskName);
                  if (task.processedCanvas) task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
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
              if (task.processedCanvas) task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
              if (task.outputContent) task.outputContent.classList.remove('active');
              if (task.outputHeader) task.outputHeader.classList.remove('active');
              if (task.wikiContent) task.wikiContent.classList.remove('active');
              if (task.wikiHeader) task.wikiHeader.classList.remove('active');
               if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
              if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
         }
     });

     await Promise.all(processingPromises);

     globalStatusDiv.textContent = 'Processing complete.';
     checkIfReady();
});

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

    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    for (const taskName of taskNames) {
        const task = tasks[taskName];
        // Get the required completed tasks for this container
        const requiredCompletedTasks = getRequiredCompletedTasks(Array.from(task.identifiedCompletedTaskIds), taskTree);

        if (requiredCompletedTasks.length > 0) {
            for (const reqTask of requiredCompletedTasks) {
                const taskId = reqTask.id; // Use the ID from the required task object
                const postUrl = `https://tarkovtracker.io/api/v2/progress/task/${taskId}`;
                const headers = {
                    'accept': '*/*',
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                };
                const body = JSON.stringify({ "state": "completed" });

                let attempt = 0;
                let success = false;

                while (attempt < maxRetries && !success) {
                    try {
                        const response = await fetch(postUrl, {
                            method: 'POST',
                            headers: headers,
                            body: body
                        });

                        if (response.ok) {
                            console.log(`Successfully posted required task ${taskId} (${reqTask.name}) as completed.`);
                            tasksPostedCount++;
                            if (task.outputArea) {
                                task.outputArea.value += `\nPosted required task ${reqTask.name} (${taskId}) as completed to TarkovTracker.`;
                            }
                            success = true;
                        } else if (response.status === 429) {
                            console.warn(`Rate limited (429) for required task ${taskId} (${reqTask.name}). Attempt ${attempt + 1} of ${maxRetries}. Retrying...`);
                            attempt++;
                            if (attempt < maxRetries) {
                                const delay = baseDelay * Math.pow(2, attempt - 1);
                                await new Promise(resolve => setTimeout(resolve, delay));
                            } else {
                                console.error(`Failed to post required task ${taskId} (${reqTask.name}) after ${maxRetries} attempts due to rate limiting.`);
                                tasksFailedCount++;
                                if (task.outputArea) {
                                    task.outputArea.value += `\nFailed to post required task ${reqTask.name} (${taskId}) after ${maxRetries} attempts (Rate Limited).`;
                                }
                            }
                        } else {
                            const errorText = await response.text();
                            console.error(`Failed to post required task ${taskId} (${reqTask.name}). Status: ${response.status}. Response: ${errorText}`);
                            tasksFailedCount++;
                            if (task.outputArea) {
                                task.outputArea.value += `\nFailed to post required task ${reqTask.name} (${taskId}). Status: ${response.status}.`;
                            }
                            success = true; // Do not retry on other errors
                        }
                    } catch (error) {
                        console.error(`Error during fetch for required task ${taskId} (${reqTask.name}). Attempt ${attempt + 1} of ${maxRetries}:`, error);
                        attempt++;
                         if (attempt < maxRetries) {
                            const delay = baseDelay * Math.pow(2, attempt - 1);
                            await new Promise(resolve => setTimeout(resolve, delay));
                         } else {
                            console.error(`Failed to post required task ${taskId} (${reqTask.name}) after ${maxRetries} attempts due to network error.`);
                            tasksFailedCount++;
                            if (task.outputArea) {
                                task.outputArea.value += `\nError posting required task ${reqTask.name} (${taskId}) after ${maxRetries} attempts: ${error.message}`;
                            }
                         }
                    }
                }
            }
        }
    }

    globalStatusDiv.textContent = `Posting complete. Successfully posted ${tasksPostedCount} tasks, failed to post ${tasksFailedCount} tasks.`;
    checkIfReady();
});

globalStatusDiv.textContent = 'Loading dependencies...';

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

const loadFuse = new Promise((resolve) => {
    if (typeof Fuse !== 'undefined') {
        console.log('Fuse.js already loaded.');
        resolve();
    } else {
         console.log('Waiting for Fuse.js to load from HTML.');
         resolve();
    }
});


Promise.all([
     loadOpenCv,
     loadFuse,
     fetchTarkovTasks(),
     new Promise((resolve) => {
         loadImageFromUrl(DISCRIMINANT_IMAGE_PATHS[0], (img) => {
             discriminantImage1 = img;
             resolve();
         });
     }),
     new Promise((resolve) => {
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
});


 taskNames.forEach(taskName => {
     const task = tasks[taskName];
     if (task.originalCanvas) task.originalCanvas.style.display = 'none';
     if (task.processedCanvas) task.processedCanvas.style.display = IS_DEV_MODE ? 'block' : 'none';
     if (task.outputArea) task.outputArea.value = '';
     if (task.wikiLinksDiv) task.wikiLinksDiv.innerHTML = '';
      if (task.requiredTasksDiv) task.requiredTasksDiv.innerHTML = '';

     if (task.outputContent) task.outputContent.classList.remove('active');
     if (task.outputHeader) task.outputHeader.classList.remove('active');
     if (task.wikiContent) task.wikiContent.classList.remove('active');
     if (task.wikiHeader) task.wikiHeader.classList.remove('active');
      if (task.requiredTasksContent) task.requiredTasksContent.classList.remove('active');
     if (task.requiredTasksHeader) task.requiredTasksHeader.classList.remove('active');
 });
