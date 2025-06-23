/**
 * Personalization and user preference management
 */

export const DEFAULT_PREFERENCES = {
    occupation: '',
    currentWork: '',
    topics: [],
    frequency: 'daily',
    digestDetailedness: 'medium',
};

/**
 * Get stored user preferences
 * @returns {Promise<Object>} User preferences
 */
export async function getStoredPreferences() {
    try {
        const { preferences } = await chrome.storage.sync.get('preferences');
        // Merge with defaults to ensure all keys are present
        return { ...DEFAULT_PREFERENCES, ...preferences };
    } catch (error) {
        console.error('Error getting preferences:', error);
        return DEFAULT_PREFERENCES;
    }
}

/**
 * Update user preferences
 * @param {Object} newPreferences New preferences to store
 * @returns {Promise<void>}
 */
export async function updatePreferences(newPreferences) {
    try {
        const currentPreferences = await getStoredPreferences();
        const updatedPreferences = {
            ...currentPreferences,
            ...newPreferences
        };
        
        await chrome.storage.sync.set({ preferences: updatedPreferences });
        return updatedPreferences;
    } catch (error) {
        console.error('Error updating preferences:', error);
        throw new Error('Failed to update preferences');
    }
}

/**
 * Score content based on user preferences
 * @param {Object} content Content to score
 * @param {Object} preferences User preferences
 * @returns {number} Content score (0-1)
 */
export function scoreContent(content, preferences) {
    let score = 0;
    const { topics } = preferences;
    
    // Score based on topic relevance
    if (topics.length > 0) {
        const topicMatches = topics.filter(topic => 
            content.title.toLowerCase().includes(topic.toLowerCase()) ||
            content.summary.toLowerCase().includes(topic.toLowerCase())
        );
        score += (topicMatches.length / topics.length) * 0.6;
    }
    
    // Score based on recency
    const daysOld = (new Date() - new Date(content.date)) / (1000 * 60 * 60 * 24);
    score += Math.max(0, 1 - (daysOld / 7)) * 0.4;
    
    return Math.min(1, score);
}

/**
 * Rank content items by relevance
 * @param {Array} items Content items to rank
 * @param {Object} preferences User preferences
 * @returns {Array} Ranked content items
 */
export function rankContent(items, preferences) {
    return items
        .map(item => ({
            ...item,
            score: scoreContent(item, preferences)
        }))
        .sort((a, b) => b.score - a.score);
}

/**
 * Categorize content by topic
 * @param {Array} items Content items to categorize
 * @returns {Object} Categorized content
 */
export function categorizeContent(items) {
    const categories = {};
    
    items.forEach(item => {
        const category = detectCategory(item);
        if (!categories[category]) {
            categories[category] = [];
        }
        categories[category].push(item);
    });
    
    return categories;
}

/**
 * Detect the category of a content item
 * @param {Object} item Content item
 * @returns {string} Detected category
 */
function detectCategory(item) {
    // TODO: Implement more sophisticated category detection
    const categoryKeywords = {
        technology: ['tech', 'software', 'hardware', 'digital', 'ai', 'ml'],
        business: ['business', 'finance', 'market', 'economy', 'startup'],
        health: ['health', 'medical', 'fitness', 'wellness', 'diet'],
        politics: ['politics', 'government', 'policy', 'election'],
        entertainment: ['entertainment', 'movie', 'music', 'tv', 'celebrity'],
        sports: ['sports', 'game', 'team', 'player', 'match'],
        science: ['science', 'research', 'study', 'discovery']
    };
    
    const content = `${item.title} ${item.summary}`.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(keyword => content.includes(keyword))) {
            return category;
        }
    }
    
    return 'other';
}

/**
 * Learn from user interactions
 * @param {Object} interaction User interaction data
 * @returns {Promise<void>}
 */
export async function learnFromInteraction(interaction) {
    try {
        const { preferences } = await chrome.storage.sync.get('preferences');
        const { type, content } = interaction;
        
        switch (type) {
            case 'read':
                // Increase score for similar content
                preferences.topics = updateTopics(preferences.topics, content);
                break;
                
            case 'skip':
                // Decrease score for similar content
                preferences.topics = updateTopics(preferences.topics, content, -0.1);
                break;
                
            case 'save':
                // Strongly increase score for similar content
                preferences.topics = updateTopics(preferences.topics, content, 0.2);
                break;
        }
        
        await chrome.storage.sync.set({ preferences });
    } catch (error) {
        console.error('Error learning from interaction:', error);
    }
}

/**
 * Update topic scores based on interaction
 * @param {Array} topics Current topics
 * @param {Object} content Content that was interacted with
 * @param {number} scoreChange Score change amount
 * @returns {Array} Updated topics
 */
function updateTopics(topics, content, scoreChange = 0.1) {
    const contentTopics = detectTopics(content);
    
    return topics.map(topic => {
        if (contentTopics.includes(topic.name)) {
            return {
                ...topic,
                score: Math.min(1, Math.max(0, topic.score + scoreChange))
            };
        }
        return topic;
    });
}

/**
 * Detect topics in content
 * @param {Object} content Content to analyze
 * @returns {Array} Detected topics
 */
function detectTopics(content) {
    // TODO: Implement more sophisticated topic detection
    const text = `${content.title} ${content.summary}`.toLowerCase();
    const topics = [];
    
    // Simple keyword matching for now
    const topicKeywords = {
        technology: ['tech', 'software', 'hardware', 'digital'],
        business: ['business', 'finance', 'market', 'economy'],
        health: ['health', 'medical', 'fitness', 'wellness'],
        politics: ['politics', 'government', 'policy'],
        entertainment: ['entertainment', 'movie', 'music', 'tv'],
        sports: ['sports', 'game', 'team', 'player'],
        science: ['science', 'research', 'study', 'discovery']
    };
    
    for (const [topic, keywords] of Object.entries(topicKeywords)) {
        if (keywords.some(keyword => text.includes(keyword))) {
            topics.push(topic);
        }
    }
    
    return topics;
}

/**
 * Saves user preferences to chrome.storage.sync.
 * @param {Object} preferences - The preferences object to save.
 * @returns {Promise<void>}
 */
export async function setStoredPreferences(preferences) {
    try {
        await chrome.storage.sync.set({ preferences });
    } catch (error) {
        console.error("Error saving preferences:", error);
        throw new Error("Could not save user preferences.");
    }
} 