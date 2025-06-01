// js/state.js

// --- Global Application State ---

// Task related state
export const tasks = {};
export let tarkovTasksData = [];
export let taskTree = {};
export let fuse = null;

// Kappa related state
export const kappaState = {
    image: null,
    processingResults: {
        foundItems: [],
        missingItems: [],
    }
};
export let kappaRequiredItemsData = [];
export let kappaRequiredItemIcons = {};
export let fuseKappa = null;
export let kappaWorker = null;

// Discriminant images (loaded at startup)
export let discriminantImage1 = null;
export let discriminantImage2 = null;


// --- Factory Functions for State Parts ---

export const createInitialTaskProcessingResults = () => ({
    discriminant1Rect: null,
    discriminant2Rect: null,
    ocrRect: null,
    identifiedCompletedTaskIds: new Set(),
    requiredTasksToPost: []
});


// --- MUTATORS: Functions to modify the state ---

// Task State Mutators
export function addTask(taskName, taskData) {
    tasks[taskName] = taskData;
}
export function getTask(taskName) {
    return tasks[taskName];
}
export function updateTaskImage(taskName, image) {
    if (tasks[taskName]) tasks[taskName].image = image;
}
export function updateTaskProcessingResults(taskName, results) {
    if (tasks[taskName]) tasks[taskName].processingResults = results;
}
export function resetTaskProcessingResults(taskName) {
    if (tasks[taskName]) {
        tasks[taskName].processingResults = createInitialTaskProcessingResults();
    }
}
export function resetTaskIdentifiedCompletedIds(taskName) {
    if (tasks[taskName]?.processingResults) {
        tasks[taskName].processingResults.identifiedCompletedTaskIds.clear();
    }
}
export function setTaskRequiredToPost(taskName, requiredTasks) {
    if (tasks[taskName]?.processingResults) {
        tasks[taskName].processingResults.requiredTasksToPost = requiredTasks;
    }
}
export function addTaskIdentifiedCompletedId(taskName, taskId) {
    if (tasks[taskName]?.processingResults?.identifiedCompletedTaskIds) {
        tasks[taskName].processingResults.identifiedCompletedTaskIds.add(taskId);
    }
}

// Tarkov Data Mutators
export function setTarkovTasksData(data) {
    tarkovTasksData = data;
}
export function setTaskTree(tree) {
    taskTree = tree;
}
export function setFuse(fuseInstance) {
    fuse = fuseInstance;
}

// Kappa State Mutators
export function setKappaImage(image) {
    kappaState.image = image;
}
export function setKappaProcessingResults(results) {
    kappaState.processingResults = results;
}
export function resetKappaProcessingResults() {
    kappaState.processingResults = { foundItems: [], missingItems: [] };
}
export function setKappaRequiredItemsData(data) {
    kappaRequiredItemsData = data;
}
export function setKappaRequiredItemIcon(itemId, iconImage) {
    kappaRequiredItemIcons[itemId] = iconImage;
}
export function clearKappaRequiredItemIcons() {
    kappaRequiredItemIcons = {};
}
export function setFuseKappa(fuseInstance) {
    fuseKappa = fuseInstance;
}
export function setKappaWorker(workerInstance) {
    kappaWorker = workerInstance;
}

// Discriminant Image Mutators
export function setDiscriminantImage1(image) {
    discriminantImage1 = image;
}
export function setDiscriminantImage2(image) {
    discriminantImage2 = image;
}