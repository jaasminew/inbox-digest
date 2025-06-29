import { getStoredPreferences, setStoredPreferences } from '../lib/personalization.js';
import { OPENAI_API_KEY } from '../lib/config.js';
import { runDebugTestAndSave, getLatestDebugResults, getAllDebugResults, runLinkFilteringTest, getLatestLinkTestResults } from '../lib/debug-email-filter.js';

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
const runDebugTestBtn = document.getElementById('runDebugTest');
const runLinkTestBtn = document.getElementById('runLinkTest');
const viewDebugResultsBtn = document.getElementById('viewDebugResults');
const downloadLinkCSVBtn = document.getElementById('downloadLinkCSV');
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
    runDebugTestBtn.addEventListener('click', handleRunDebugTest);
    runLinkTestBtn.addEventListener('click', handleRunLinkTest);
    viewDebugResultsBtn.addEventListener('click', handleViewDebugResults);
    downloadLinkCSVBtn.addEventListener('click', handleDownloadLinkCSV);
    viewHistoryBtn.addEventListener('click', openHistoryPage);
    exportDataBtn.addEventListener('click', handleExportData);
    
    // Add close button functionality
    const closeBtn = document.getElementById('closePopup');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            window.close();
        });
    }
    
    // Note: Chrome extension popups automatically close when they lose focus
    // This is by design and cannot be overridden for security reasons.
    // Operations will continue in the background service worker.
    
    // Add visibility change listener to warn user about popup behavior
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            console.log('[Popup] Popup lost focus - operations continue in background');
        }
    });
    
    // Prevent popup from closing on certain internal clicks
    document.addEventListener('click', (e) => {
        // Keep focus on the popup window
        if (e.target.closest('.container')) {
            e.stopPropagation();
            window.focus();
        }
    });
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
    summaryResult.innerHTML = '<p>Contacting background service...</p><p><em>Generation continues in background if popup closes.</em></p>';

    try {
        const userPreferences = await getStoredPreferences();
        const period = (userPreferences && userPreferences.digestFrequency === 'daily') ? '1d' : '7d';
        const response = await chrome.runtime.sendMessage({ type: 'GENERATE_DIGEST', period: period });
        
        summaryResult.innerHTML = '<p>Processing digest...</p><p><em>Processing continues in background.</em></p>';

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

async function handleRunDebugTest() {
    runDebugTestBtn.disabled = true;
    runDebugTestBtn.textContent = 'Running Debug Test...';
    summaryResult.innerHTML = '<p>Starting email filter debug test...</p><p><em>Note: Test will continue in background if popup closes.</em></p><p><strong>⚠️ Keep this popup focused to see results!</strong></p>';

    try {
        summaryResult.innerHTML = '<p>Running 2 test cycles, fetching 20 emails each...</p><p><em>Test continues in background if popup closes.</em></p><p><strong>⚠️ Keep this popup focused!</strong></p>';
        
        const result = await runDebugTestAndSave();
        
        const totalEmails = result.testResults.reduce((sum, run) => sum + run.emailRecords.length, 0);
        
        summaryResult.innerHTML = `
            <p><strong>Debug test completed successfully!</strong></p>
            <p>• Processed ${result.testResults.length} test runs</p>
            <p>• Total emails tested: ${totalEmails}</p>
            <p>• CSV organized into ${result.testResults.length} separate sheets (2 runs)</p>
            <p>• Each sheet contains individual email records with AI decisions</p>
            <p>• Click "📊 View CSV Results" button to download your data</p>
            <p><em>Console logs show detailed filtering decisions</em></p>
        `;
    } catch (error) {
        console.error('Debug test failed:', error);
        summaryResult.innerHTML = `<p class="error">Debug test failed: ${error.message}</p>`;
    } finally {
        runDebugTestBtn.disabled = false;
        runDebugTestBtn.textContent = '🔍 Debug Test';
    }
}

async function handleRunLinkTest() {
    runLinkTestBtn.disabled = true;
    runLinkTestBtn.textContent = 'Testing Link Filtering...';
    summaryResult.innerHTML = '<p>Starting link filtering algorithm test...</p><p><em>Testing on latest 10 emails from your inbox.</em></p><p><strong>⚠️ Keep this popup focused to see results!</strong></p>';

    try {
        const result = await runLinkFilteringTest();
        
        if (result.success) {
            const summary = result.results.summary;
            summaryResult.innerHTML = `
                <p><strong>Link filtering test completed!</strong></p>
                <p>• Tested ${summary.totalEmails} emails</p>
                <p>• Found ${summary.totalLinksFound} total links</p>
                <p>• Kept ${summary.totalLinksKept} relevant links</p>
                <p>• Average filtering rate: ${summary.averageFilteringRate}%</p>
                <p>• CSV file generated and ready for download</p>
                <p><em>Check console logs for detailed per-email results</em></p>
                <button onclick="showLinkTestDetails()" class="btn btn-secondary" style="margin-top: 10px;">📋 Show Details</button>
            `;
            
            // Store results globally for the details function
            window.linkTestResults = result.results;
            
        } else {
            summaryResult.innerHTML = `<p class="error">Link filtering test failed: ${result.error}</p>`;
        }
    } catch (error) {
        console.error('Link filtering test failed:', error);
        summaryResult.innerHTML = `<p class="error">Link filtering test failed: ${error.message}</p>`;
    } finally {
        runLinkTestBtn.disabled = false;
        runLinkTestBtn.textContent = '🔗 Test Link Filtering';
    }
}

async function handleDownloadLinkCSV() {
    try {
        const linkTestResults = await getLatestLinkTestResults();
        
        if (!linkTestResults || !linkTestResults.csvContent) {
            summaryResult.innerHTML = '<p>No link filtering test results found. Run a link filtering test first.</p>';
            return;
        }
        
        // Create and download the CSV file
        const csvContent = linkTestResults.csvContent;
        const filename = linkTestResults.csvFilename || 'link_filtering_results.csv';
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        // Create a temporary link to download the file
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        summaryResult.innerHTML = `
            <p><strong>CSV file downloaded!</strong></p>
            <p>• File: ${filename}</p>
            <p>• Generated: ${new Date(linkTestResults.timestamp).toLocaleString()}</p>
            <p>• Tested ${linkTestResults.summary.totalEmails} emails</p>
            <p>• Check your Downloads folder</p>
        `;
        
    } catch (error) {
        console.error('Error downloading link CSV:', error);
        summaryResult.innerHTML = `<p class="error">Error downloading CSV: ${error.message}</p>`;
    }
}

async function handleViewDebugResults() {
    try {
        const latestResults = await getLatestDebugResults();
        
        if (!latestResults) {
            summaryResult.innerHTML = '<p>No debug test results found. Run a debug test first.</p>';
            return;
        }
        
        // Create a new tab with the CSV content
        const csvContent = latestResults.content;
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        // Create a temporary link to download the file
        const a = document.createElement('a');
        a.href = url;
        a.download = latestResults.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        summaryResult.innerHTML = `
            <p><strong>CSV file downloaded!</strong></p>
            <p>• File: ${latestResults.filename}</p>
            <p>• Generated: ${new Date(latestResults.timestamp).toLocaleString()}</p>
            <p>• Check your Downloads folder</p>
        `;
        
        // Also log to console as backup
        console.log('='.repeat(60));
        console.log('DEBUG TEST CSV CONTENT:');
        console.log('='.repeat(60));
        console.log(csvContent);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('Error viewing debug results:', error);
        summaryResult.innerHTML = `<p class="error">Error accessing debug results: ${error.message}</p>`;
    }
}

// Global function for showing link test details
window.showLinkTestDetails = function() {
    if (!window.linkTestResults) {
        alert('No link test results available');
        return;
    }
    
    const results = window.linkTestResults;
    let detailsText = `LINK FILTERING TEST RESULTS\n`;
    detailsText += `${'='.repeat(50)}\n\n`;
    detailsText += `Summary:\n`;
    detailsText += `- Emails tested: ${results.summary.totalEmails}\n`;
    detailsText += `- Total links found: ${results.summary.totalLinksFound}\n`;
    detailsText += `- Relevant links kept: ${results.summary.totalLinksKept}\n`;
    detailsText += `- Average filtering rate: ${results.summary.averageFilteringRate}%\n\n`;
    
    results.results.forEach((email, index) => {
        detailsText += `${index + 1}. "${email.subject}" (from ${email.from})\n`;
        detailsText += `   Links: ${email.totalLinks} total → ${email.filteredLinks} relevant (${email.filteringRate}% filtered)\n`;
        
        if (email.relevantLinks && email.relevantLinks.length > 0) {
            detailsText += `   Kept links:\n`;
            email.relevantLinks.forEach(link => {
                detailsText += `     • "${link.text}" (${link.url})\n`;
            });
        } else {
            detailsText += `   No relevant links found\n`;
        }
        detailsText += `\n`;
    });
    
    // Create a new window/tab with the results
    const newWindow = window.open('', '_blank');
    newWindow.document.write(`
        <html>
        <head><title>Link Filtering Test Results</title></head>
        <body style="font-family: monospace; white-space: pre-wrap; padding: 20px;">
        ${detailsText}
        </body>
        </html>
    `);
} 