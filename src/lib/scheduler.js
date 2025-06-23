/**
 * Scheduler for automatic digest generation
 */

import { getStoredPreferences, updatePreferences } from './personalization.js';

const ALARM_NAME = 'generateDigest';

/**
 * Schedule the next digest generation
 * @param {string} frequency Generation frequency
 * @returns {Promise<void>}
 */
export async function scheduleNextDigest(frequency) {
    try {
        const nextTime = calculateNextGenerationTime(frequency);
        
        // Create or update alarm
        await chrome.alarms.create(ALARM_NAME, {
            when: nextTime.getTime()
        });
        
        // Store next scheduled time
        await chrome.storage.sync.set({
            nextScheduled: nextTime.toISOString()
        });
    } catch (error) {
        console.error('Error scheduling next digest:', error);
        throw new Error('Failed to schedule next digest');
    }
}

/**
 * Calculate the next generation time based on frequency
 * @param {string} frequency Generation frequency
 * @returns {Date} Next generation time
 */
function calculateNextGenerationTime(frequency) {
    const now = new Date();
    let nextTime;
    
    switch (frequency) {
        case 'daily':
            nextTime = addDays(now, 1);
            break;
            
        case 'weekly':
            nextTime = addWeeks(now, 1);
            break;
            
        case 'monthly':
            nextTime = addMonths(now, 1);
            break;
            
        default:
            nextTime = addDays(now, 1);
    }
    
    // Set time to 8:00 AM
    nextTime = setHours(nextTime, 8);
    nextTime = setMinutes(nextTime, 0);
    
    // If the calculated time is in the past, add one more interval
    if (nextTime <= now) {
        switch (frequency) {
            case 'daily':
                nextTime = addDays(nextTime, 1);
                break;
            case 'weekly':
                nextTime = addWeeks(nextTime, 1);
                break;
            case 'monthly':
                nextTime = addMonths(nextTime, 1);
                break;
        }
    }
    
    return nextTime;
}

/**
 * Cancel scheduled digest generation
 * @returns {Promise<void>}
 */
export async function cancelScheduledDigest() {
    try {
        await chrome.alarms.clear(ALARM_NAME);
        await chrome.storage.sync.set({ nextScheduled: null });
    } catch (error) {
        console.error('Error canceling scheduled digest:', error);
        throw new Error('Failed to cancel scheduled digest');
    }
}

/**
 * Get the next scheduled generation time
 * @returns {Promise<Date|null>} Next scheduled time
 */
export async function getNextScheduledTime() {
    try {
        const { nextScheduled } = await chrome.storage.sync.get('nextScheduled');
        return nextScheduled ? new Date(nextScheduled) : null;
    } catch (error) {
        console.error('Error getting next scheduled time:', error);
        return null;
    }
}

/**
 * Initialize scheduler
 * @returns {Promise<void>}
 */
export async function initializeScheduler() {
    try {
        const preferences = await getStoredPreferences();
        const { nextScheduled } = await chrome.storage.sync.get('nextScheduled');
        
        // If no schedule exists, create one
        if (!nextScheduled) {
            await scheduleNextDigest(preferences.frequency);
        }
        
        // Verify alarm exists
        const alarm = await chrome.alarms.get(ALARM_NAME);
        if (!alarm) {
            await scheduleNextDigest(preferences.frequency);
        }
    } catch (error) {
        console.error('Error initializing scheduler:', error);
        throw new Error('Failed to initialize scheduler');
    }
}

/**
 * Update schedule when preferences change
 * @param {Object} newPreferences New preferences
 * @returns {Promise<void>}
 */
export async function updateSchedule(preferences) {
    await cancelScheduledDigest();

    if (preferences.frequency === 'disabled') {
        console.log('Digest scheduling disabled.');
        return;
    }

    const periodInMinutes = {
        'daily': 24 * 60,
        'weekly': 7 * 24 * 60
    }[preferences.frequency];

    if (periodInMinutes) {
        chrome.alarms.create(ALARM_NAME, {
            delayInMinutes: 1, // Start 1 minute from now for testing
            periodInMinutes: periodInMinutes
        });
        console.log(`Digest scheduled with frequency: ${preferences.frequency}`);
    }
}

/**
 * Check if digest generation is overdue
 * @returns {Promise<boolean>} Whether generation is overdue
 */
export async function isGenerationOverdue() {
    try {
        const { lastGenerated } = await chrome.storage.sync.get('lastGenerated');
        const preferences = await getStoredPreferences();
        
        if (!lastGenerated) {
            return true;
        }
        
        const lastGeneratedDate = new Date(lastGenerated);
        const now = new Date();
        
        switch (preferences.frequency) {
            case 'daily':
                return now.getTime() - lastGeneratedDate.getTime() > 24 * 60 * 60 * 1000;
            case 'weekly':
                return now.getTime() - lastGeneratedDate.getTime() > 7 * 24 * 60 * 60 * 1000;
            case 'monthly':
                return now.getTime() - lastGeneratedDate.getTime() > 30 * 24 * 60 * 60 * 1000;
            default:
                return false;
        }
    } catch (error) {
        console.error('Error checking if generation is overdue:', error);
        return false;
    }
} 