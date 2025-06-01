// js/api.js
import * as Config from './config.js';
import * as DOM from './dom.js';
import * as State from './state.js';
import { reportGlobalStatus, setButtonEnabled } from './ui.js';
import { loadImageFromUrl } from './imageUtils.js';
import { updateButtonStates } from './main.js'; 



async function loadItemIcon(item) {
    if (!item.id) {
        State.setKappaRequiredItemIcon(item.id, null); 
        return null;
    }
    const localIconUrl = `${Config.KAPPA_ITEM_ICON_BASE_PATH}/${item.id}.webp`;

    return new Promise((resolve) => {
        loadImageFromUrl(localIconUrl,
            (img) => {
                State.setKappaRequiredItemIcon(item.id, img);
                resolve(img);
            },
            (error) => {
                console.warn(`Could not load icon for ${item.name} (ID: ${item.id}) from ${localIconUrl}:`, error);
                State.setKappaRequiredItemIcon(item.id, null); 
                resolve(null); 
            }
        );
    });
}

export async function fetchTarkovData() {
    reportGlobalStatus('Fetching data from Tarkov.dev...');
    const query = `
        query TarkovData {
            tasks(lang: en) { name id taskRequirements { task { name id } status } trader { name } wikiLink }
            task(id: "${Config.KAPPA_TASK_ID}") { name objectives { ... on TaskObjectiveItem { id items { name shortName id wikiLink iconLink }}}}
        }
    `;
    const apiKey = DOM.apiKeyInput?.value.trim() ?? '';
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (apiKey) {
        headers['x-api-key'] = apiKey; // Add API key header if present
    }

    try {
        const response = await fetch('https://api.tarkov.dev/graphql', { method: 'POST', headers, body: JSON.stringify({ query }) });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`GraphQL request failed: ${response.status} ${response.statusText}. Response: ${errorText}`);
        }
        const data = await response.json();

        if (data.errors) {
            throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
        }
        if (!data.data) {
            throw new Error('GraphQL response missing "data" field.');
        }

        State.setTarkovTasksData(data.data.tasks || []);

        const kappaTask = data.data.task;
        if (kappaTask?.objectives) {
            const items = kappaTask.objectives.flatMap(obj => obj.items || []);
            State.setKappaRequiredItemsData(items);
            reportGlobalStatus('Loading Kappa item icons (local only)...');
            State.clearKappaRequiredItemIcons();

            const iconLoadPromises = State.kappaRequiredItemsData.map(item => loadItemIcon(item));
            await Promise.all(iconLoadPromises);

            if (State.kappaRequiredItemsData.length > 0 && typeof Fuse !== 'undefined') {
                 const fuseKappaInstance = new Fuse(State.kappaRequiredItemsData, {
                    keys: ['name', 'shortName'],
                    includeScore: true,
                    threshold: Config.FUSE_THRESHOLD_KAPPA, // Uses direct value
                    ignoreLocation: true,
                    distance: 100,
                    isCaseSensitive: false,
                    minMatchCharLength: 3,
                    findAllMatches: false
                });
                State.setFuseKappa(fuseKappaInstance);
            }
        } else {
            State.setKappaRequiredItemsData([]);
            console.warn("Kappa task data or objectives not found in API response.");
        }

        if (typeof Fuse !== 'undefined' && State.tarkovTasksData.length > 0) {
            const fuseInstance = new Fuse(State.tarkovTasksData, {
                keys: ['name'], includeScore: true, threshold: Config.FUSE_THRESHOLD,
                ignoreLocation: true, distance: 100, isCaseSensitive: false,
                findAllMatches: false, minMatchCharLength: 3
            });
            State.setFuse(fuseInstance);
        }

        State.setTaskTree(buildTaskTree(State.tarkovTasksData));
        updateButtonStates(); // Update UI based on new data
        return { tasks: State.tarkovTasksData, kappaItems: State.kappaRequiredItemsData };

    } catch (error) {
        console.error('Error fetching Tarkov data:', error);
        reportGlobalStatus(`Error fetching data: ${error.message}. Check console.`);
        State.setTarkovTasksData([]);
        State.setKappaRequiredItemsData([]);
        State.setFuseKappa(null);
        State.setFuse(null);
        State.setTaskTree({});
        updateButtonStates();
        return null;
    }
}

function buildTaskTree(tasksData) {
    if (!Array.isArray(tasksData)) return {};
    return tasksData.reduce((acc, task) => {
        if (task && task.id) { 
            acc[task.id] = { ...task, taskRequirements: task.taskRequirements || [] };
        }
        return acc;
    }, {});
}

export async function postCompletedTasksToTracker() {
    const apiKey = DOM.apiKeyInput?.value.trim();
    if (!apiKey) {
        reportGlobalStatus('Please enter your TarkovTracker API key.');
        return;
    }
    setButtonEnabled(DOM.postCompletedTasksButton, false);
    reportGlobalStatus('Preparing tasks for posting...');

    const taskIdsToPostSet = new Set();
    Config.TRADER_NAMES.forEach(name => {
        State.getTask(name)?.processingResults?.requiredTasksToPost?.forEach(id => taskIdsToPostSet.add(id));
    });

    const tasksToPost = Array.from(taskIdsToPostSet).map(id => ({ id, state: "completed" }));

    if (tasksToPost.length === 0) {
        reportGlobalStatus('No completed prerequisite tasks identified to post.');
        updateButtonStates();
        return;
    }

    reportGlobalStatus(`Posting ${tasksToPost.length} completed tasks to TarkovTracker...`);
    try {
        const response = await fetch('https://tarkovtracker.io/api/v2/progress/tasks/', {
            method: 'POST',
            headers: {
                'accept': '*/*',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(tasksToPost)
        });
        const responseBody = await response.text();
        if (response.ok) {
            reportGlobalStatus(`Successfully posted ${tasksToPost.length} tasks.`);
        } else {
            reportGlobalStatus(`Failed to post tasks. Status: ${response.status}. Check console.`);
            console.error(`Failed to post tasks. Status: ${response.status}. Response: ${responseBody}`);
        }
    } catch (error) {
        reportGlobalStatus(`Error posting tasks: ${error.message}`);
        console.error('Error posting tasks:', error);
    } finally {
        updateButtonStates();
    }
}