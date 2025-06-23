import { getStoredPreferences, updatePreferences, DEFAULT_PREFERENCES } from '../lib/personalization.js';
import { updateSchedule, cancelScheduledDigest } from '../lib/scheduler.js';

// DOM Elements
const form = document.getElementById('preferencesForm');
const resetBtn = document.getElementById('resetBtn');

// Initialize form with stored preferences
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const preferences = await getStoredPreferences();
        populateForm(preferences);
    } catch (error) {
        console.error('Error loading preferences:', error);
        // TODO: Implement a user-facing error message
    }
});

// Handle form submission
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    try {
        const formData = new FormData(form);
        const topics = formData.get('topics').split(',').map(t => t.trim()).filter(Boolean);
        
        const preferences = {
            occupation: formData.get('occupation'),
            currentWork: formData.get('currentWork'),
            topics: topics,
            frequency: formData.get('frequency'),
            digestDetailedness: formData.get('digestDetailedness'),
        };
        
        await updatePreferences(preferences);

        if (preferences.frequency === 'disabled') {
            await cancelScheduledDigest();
        } else {
            await updateSchedule(preferences);
        }
        
        showSuccess('Preferences saved successfully!');
    } catch (error) {
        console.error('Error saving preferences:', error);
        showError('Failed to save preferences.');
    }
});

// Handle reset button
resetBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all preferences to their default values?')) {
        try {
            await updatePreferences(DEFAULT_PREFERENCES);
            populateForm(DEFAULT_PREFERENCES);
            await updateSchedule(DEFAULT_PREFERENCES);
            showSuccess('Preferences have been reset to defaults.');
        } catch (error)
        {
            console.error('Error resetting preferences:', error);
            showError('Failed to reset preferences.');
        }
    }
});

// Helper Functions
function populateForm(preferences) {
    form.occupation.value = preferences.occupation || '';
    form.currentWork.value = preferences.currentWork || '';
    form.topics.value = (preferences.topics || []).join(', ');
    form.frequency.value = preferences.frequency || 'daily';
    form.digestDetailedness.value = preferences.digestDetailedness || 'medium';
}

function showSuccess(message) {
    // TODO: Implement a more elegant notification system
    alert(message);
}

function showError(message) {
    // TODO: Implement a more elegant notification system
    alert(message);
} 