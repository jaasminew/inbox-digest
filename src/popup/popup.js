import { getStoredPreferences, setStoredPreferences } from '../lib/personalization.js';
import { OPENAI_API_KEY } from '../lib/config.js';

// --- DOM Elements ---
const onboardingView = document.getElementById('onboarding-view');
const mainView = document.getElementById('main-view');
const settingsView = document.getElementById('settings-view');

// Onboarding Form Elements
const preferencesForm = document.getElementById('preferencesForm');
const occupationInput = document.getElementById('occupation');
const currentWorkInput = document.getElementById('currentWork');
const topicsInput = document.getElementById('topics');
const digestFrequencyInput = document.getElementById('digestFrequency');

// Settings Form Elements
const settingsForm = document.getElementById('settingsForm');
const settingsOccupationInput = document.getElementById('settingsOccupation');
const settingsCurrentWorkInput = document.getElementById('settingsCurrentWork');
const settingsTopicsInput = document.getElementById('settingsTopics');
const settingsDigestFrequencyInput = document.getElementById('settingsDigestFrequency');
const cancelSettingsBtn = document.getElementById('cancelSettings');

// Main App Elements
const gmailStatus = document.getElementById('gmailStatus');
const openaiStatus = document.getElementById('openaiStatus');
const preferencesStatus = document.getElementById('preferencesStatus');
const generateDigestBtn = document.getElementById('generateDigest');
const openOptionsBtn = document.getElementById('openOptions');
const openInsightsBtn = document.getElementById('openInsights');
const summaryResult = document.getElementById('summaryResult');
const viewHistoryBtn = document.getElementById('viewHistory');
const exportDataBtn = document.getElementById('exportData');

let userPreferences = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', initializePopup);

async function initializePopup() {
    userPreferences = await getStoredPreferences();
    if (userPreferences && userPreferences.onboardingComplete) {
        renderMainView();
    } else {
        renderOnboardingView();
    }
    // renderOnboardingView(); // Temporarily force for UI review
}


// --- View Rendering ---
function renderOnboardingView() {
    onboardingView.style.display = 'block';
    mainView.style.display = 'none';
    settingsView.style.display = 'none';
    preferencesForm.addEventListener('submit', handlePreferencesSubmit);
}

async function renderMainView() {
    onboardingView.style.display = 'none';
    mainView.style.display = 'block';
    settingsView.style.display = 'none';
    setupMainEventListeners();
    await checkStatus();
    updateGenerateButtonText();
}

function renderSettingsView() {
    onboardingView.style.display = 'none';
    mainView.style.display = 'none';
    settingsView.style.display = 'block';
    populateSettingsForm();
    settingsForm.addEventListener('submit', handleSettingsUpdate);
    cancelSettingsBtn.addEventListener('click', () => {
        settingsForm.removeEventListener('submit', handleSettingsUpdate);
        renderMainView();
    });
}


// --- Event Handlers & Logic ---
async function handlePreferencesSubmit(event) {
    event.preventDefault();
    const topicsValue = topicsInput.value;
    const preferences = {
        occupation: occupationInput.value,
        currentWork: currentWorkInput.value,
        topics: topicsValue.split(',').map(t => t.trim()).filter(t => t),
        digestFrequency: digestFrequencyInput.value,
        onboardingComplete: true
    };

    try {
        await setStoredPreferences(preferences);
        userPreferences = preferences;
        renderMainView();
    } catch (error) {
        console.error("Failed to save preferences:", error);
    }
}

async function populateSettingsForm() {
    if (userPreferences) {
        settingsOccupationInput.value = userPreferences.occupation || '';
        settingsCurrentWorkInput.value = userPreferences.currentWork || '';
        settingsTopicsInput.value = userPreferences.topics ? userPreferences.topics.join(', ') : '';
        settingsDigestFrequencyInput.value = userPreferences.digestFrequency || 'daily';
    }
}

async function handleSettingsUpdate(event) {
    event.preventDefault();
    const topicsValue = settingsTopicsInput.value;
    const preferences = {
        occupation: settingsOccupationInput.value,
        currentWork: settingsCurrentWorkInput.value,
        topics: topicsValue.split(',').map(t => t.trim()).filter(t => t),
        digestFrequency: settingsDigestFrequencyInput.value,
        onboardingComplete: true
    };

    try {
        await setStoredPreferences(preferences);
        userPreferences = preferences;
        renderMainView();
    } catch (error) {
        console.error("Failed to update preferences:", error);
    }
}

function setupMainEventListeners() {
    generateDigestBtn.addEventListener('click', handleGenerateDigest);
    openOptionsBtn.addEventListener('click', renderSettingsView);
    openInsightsBtn.addEventListener('click', openInsightsPage);
    viewHistoryBtn.addEventListener('click', openHistoryPage);
    exportDataBtn.addEventListener('click', handleExportData);
}

function setStatus(element, text, statusClass) {
    element.textContent = text;
    element.className = `status-indicator ${statusClass}`;
}

async function checkStatus() {
    setStatus(gmailStatus, 'Checking...', 'not-configured');
    setStatus(openaiStatus, 'Checking...', 'not-configured');
    setStatus(preferencesStatus, 'Checking...', 'not-configured');

    const gmailCheck = chrome.identity.getAuthToken({ interactive: false })
        .then(() => setStatus(gmailStatus, 'Connected', 'configured'))
        .catch(() => setStatus(gmailStatus, 'Not Connected', 'not-configured'));

    const openaiCheck = Promise.resolve().then(() => {
        if (OPENAI_API_KEY && !OPENAI_API_KEY.includes('...')) {
            setStatus(openaiStatus, 'Configured', 'configured');
        } else {
            setStatus(openaiStatus, 'Not Configured', 'error');
        }
    });

    const preferencesCheck = getStoredPreferences()
        .then(prefs => {
            if (prefs && prefs.occupation) {
                setStatus(preferencesStatus, 'Set', 'configured');
            } else {
                setStatus(preferencesStatus, 'Not Set', 'not-configured');
            }
        })
        .catch(() => setStatus(preferencesStatus, 'Error', 'error'));

    await Promise.all([gmailCheck, openaiCheck, preferencesCheck]);
}

async function handleGenerateDigest() {
    generateDigestBtn.disabled = true;
    generateDigestBtn.textContent = 'Generating...';
    summaryResult.innerHTML = '<p>Contacting background service...</p>';

    try {
        const period = (userPreferences && userPreferences.digestFrequency === 'daily') ? '1d' : '7d';
        const response = await chrome.runtime.sendMessage({ type: 'GENERATE_DIGEST', period: period });
        
        summaryResult.innerHTML = '<p>Processing digest...</p>';

        if (response && response.success) {
            const digestUrl = chrome.runtime.getURL('src/digest/digest.html');
            const newTab = await chrome.tabs.create({ url: digestUrl });

            // This listener waits for the new tab to be fully loaded before sending data.
            const listener = (tabId, changeInfo) => {
                if (tabId === newTab.id && changeInfo.status === 'complete') {
                    chrome.tabs.sendMessage(tabId, { type: 'LOAD_DIGEST', digest: response.digest });
                    chrome.tabs.onUpdated.removeListener(listener);
                }
            };
            chrome.tabs.onUpdated.addListener(listener);

            summaryResult.innerHTML = '<p>Success! Your digest has been opened in a new tab.</p>';

        } else {
            const errorMessage = response ? response.error : 'An unknown error occurred.';
            throw new Error(errorMessage);
        }
    } catch (error) {
        console.error('Failed to generate digest:', error);
        summaryResult.innerHTML = `<p class="error">Error: ${error.message}</p>`;
    } finally {
        generateDigestBtn.disabled = false;
        updateGenerateButtonText();
    }
}

function openInsightsPage() {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/insights/insights.html') });
}

function openHistoryPage() {
    alert('History feature coming soon!');
}

async function handleExportData() {
    try {
        const data = await chrome.storage.local.get();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `inbox-digest-data-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        alert('Failed to export data');
    }
}

function updateGenerateButtonText() {
    if (userPreferences && userPreferences.digestFrequency) {
        const frequency = userPreferences.digestFrequency; // 'daily' or 'weekly'
        const capitalized = frequency.charAt(0).toUpperCase() + frequency.slice(1);
        generateDigestBtn.textContent = `🚀 Generate ${capitalized} Digest`;
    } else {
        generateDigestBtn.textContent = '🚀 Generate Digest';
    }
} 