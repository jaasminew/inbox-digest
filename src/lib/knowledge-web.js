/**
 * Knowledge Web - Builds comprehensive overview from historical digest data
 * Identifies trends, patterns, and business opportunities over time
 */

import { getStoredPreferences } from './personalization.js';
import { Readability } from './Readability.js';

// Storage keys
const KNOWLEDGE_WEB_KEY = 'knowledgeWeb';
const DIGEST_HISTORY_KEY = 'digestHistory';

/**
 * Knowledge Web Data Structure
 */
export class KnowledgeWeb {
    constructor() {
        this.digests = []; // Array of historical digests
        this.topics = new Map(); // Topic -> frequency, trends, connections
        this.entities = new Map(); // Companies, people, technologies -> mentions, sentiment
        this.trends = []; // Identified trends over time
        this.opportunities = []; // Business opportunities identified
        this.lastAnalysis = null; // Timestamp of last analysis
    }

    /**
     * Add a new digest to the knowledge web
     * @param {Object} digest - The digest object with content, date, etc.
     */
    async addDigest(digest) {
        const digestEntry = {
            id: this.generateDigestId(),
            date: new Date().toISOString(),
            content: digest.content,
            topics: await this.extractTopics(digest.content),
            entities: await this.extractEntities(digest.content),
            sentiment: await this.analyzeSentiment(digest.content),
            metadata: {
                sourceEmails: digest.sourceEmails || [],
                userPreferences: await getStoredPreferences()
            }
        };

        this.digests.push(digestEntry);
        await this.updateKnowledgeWeb();
        await this.saveToStorage();
    }

    /**
     * Extract key topics from digest content
     * @param {string} content - Digest content
     * @returns {Array} Array of topics with confidence scores
     */
    async extractTopics(content) {
        // TODO: Use OpenAI API to extract topics
        // This will identify recurring themes, technologies, industries, etc.
        return [];
    }

    /**
     * Extract entities (companies, people, technologies) from content
     * @param {string} content - Digest content
     * @returns {Array} Array of entities with metadata
     */
    async extractEntities(content) {
        // TODO: Use OpenAI API to extract and categorize entities
        // Companies, people, technologies, products, etc.
        return [];
    }

    /**
     * Analyze sentiment and tone of the content
     * @param {string} content - Digest content
     * @returns {Object} Sentiment analysis results
     */
    async analyzeSentiment(content) {
        // TODO: Use OpenAI API to analyze sentiment
        // Positive, negative, neutral, excitement level, etc.
        return {
            overall: 'neutral',
            confidence: 0.5,
            emotions: []
        };
    }

    /**
     * Update the knowledge web with new insights
     */
    async updateKnowledgeWeb() {
        await this.identifyTrends();
        await this.findConnections();
        await this.identifyOpportunities();
        this.lastAnalysis = new Date().toISOString();
    }

    /**
     * Identify trends across multiple digests
     */
    async identifyTrends() {
        // TODO: Analyze topic frequency over time
        // Identify emerging trends, declining topics, seasonal patterns
        this.trends = [];
    }

    /**
     * Find connections between different topics and entities
     */
    async findConnections() {
        // TODO: Build a graph of topic/entity relationships
        // Identify which topics often appear together
        // Track how relationships evolve over time
    }

    /**
     * Identify potential business opportunities
     */
    async identifyOpportunities() {
        // TODO: Use OpenAI to analyze patterns and suggest opportunities
        // Market gaps, emerging technologies, partnership opportunities, etc.
        this.opportunities = [];
    }

    /**
     * Generate insights report
     * @returns {Object} Comprehensive insights report
     */
    async generateInsightsReport() {
        const preferences = await getStoredPreferences();
        
        return {
            summary: await this.generateSummary(),
            trends: this.getRelevantTrends(preferences),
            opportunities: this.getRelevantOpportunities(preferences),
            recommendations: await this.generateRecommendations(preferences),
            timeline: this.generateTimeline(),
            lastUpdated: this.lastAnalysis
        };
    }

    /**
     * Generate executive summary of knowledge web
     */
    async generateSummary() {
        // TODO: Use OpenAI to create a high-level summary
        // "Over the past X months, we've tracked Y major trends..."
        return "";
    }

    /**
     * Get trends relevant to user's occupation and interests
     * @param {Object} preferences - User preferences
     */
    getRelevantTrends(preferences) {
        // TODO: Filter trends based on user's professional context
        return this.trends.filter(trend => 
            this.isRelevantToUser(trend, preferences)
        );
    }

    /**
     * Get opportunities relevant to user's context
     * @param {Object} preferences - User preferences
     */
    getRelevantOpportunities(preferences) {
        // TODO: Filter opportunities based on user's professional context
        return this.opportunities.filter(opp => 
            this.isRelevantToUser(opp, preferences)
        );
    }

    /**
     * Generate personalized recommendations
     * @param {Object} preferences - User preferences
     */
    async generateRecommendations(preferences) {
        // TODO: Use OpenAI to generate actionable recommendations
        // Based on trends, opportunities, and user's professional context
        return [];
    }

    /**
     * Generate timeline of key events
     */
    generateTimeline() {
        // TODO: Create a chronological timeline of major events
        // Group by month/quarter, highlight significant developments
        return [];
    }

    /**
     * Check if a trend/opportunity is relevant to user
     * @param {Object} item - Trend or opportunity
     * @param {Object} preferences - User preferences
     */
    isRelevantToUser(item, preferences) {
        // TODO: Implement relevance scoring based on user's occupation and interests
        return true;
    }

    /**
     * Save knowledge web to storage
     */
    async saveToStorage() {
        try {
            await chrome.storage.local.set({
                [KNOWLEDGE_WEB_KEY]: {
                    digests: this.digests,
                    topics: Array.from(this.topics.entries()),
                    entities: Array.from(this.entities.entries()),
                    trends: this.trends,
                    opportunities: this.opportunities,
                    lastAnalysis: this.lastAnalysis
                }
            });
        } catch (error) {
            console.error('Error saving knowledge web:', error);
        }
    }

    /**
     * Load knowledge web from storage
     */
    async loadFromStorage() {
        try {
            const data = await chrome.storage.local.get(KNOWLEDGE_WEB_KEY);
            if (data[KNOWLEDGE_WEB_KEY]) {
                const web = data[KNOWLEDGE_WEB_KEY];
                this.digests = web.digests || [];
                this.topics = new Map(web.topics || []);
                this.entities = new Map(web.entities || []);
                this.trends = web.trends || [];
                this.opportunities = web.opportunities || [];
                this.lastAnalysis = web.lastAnalysis;
            }
        } catch (error) {
            console.error('Error loading knowledge web:', error);
        }
    }

    /**
     * Generate unique digest ID
     */
    generateDigestId() {
        return `digest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get statistics about the knowledge web
     */
    getStats() {
        return {
            totalDigests: this.digests.length,
            dateRange: {
                start: this.digests.length > 0 ? this.digests[0].date : null,
                end: this.digests.length > 0 ? this.digests[this.digests.length - 1].date : null
            },
            totalTopics: this.topics.size,
            totalEntities: this.entities.size,
            totalTrends: this.trends.length,
            totalOpportunities: this.opportunities.length,
            lastAnalysis: this.lastAnalysis
        };
    }

    /**
     * Clear all knowledge web data
     */
    async clear() {
        this.digests = [];
        this.topics.clear();
        this.entities.clear();
        this.trends = [];
        this.opportunities = [];
        this.lastAnalysis = null;
        await this.saveToStorage();
    }
}

// Singleton instance
let knowledgeWebInstance = null;

/**
 * Get the knowledge web instance
 * @returns {Promise<KnowledgeWeb>}
 */
export async function getKnowledgeWeb() {
    if (!knowledgeWebInstance) {
        knowledgeWebInstance = new KnowledgeWeb();
        await knowledgeWebInstance.loadFromStorage();
    }
    return knowledgeWebInstance;
}

/**
 * Add a new digest to the knowledge web
 * @param {Object} digest - Digest object
 */
export async function addDigestToKnowledgeWeb(digest) {
    const web = await getKnowledgeWeb();
    await web.addDigest(digest);
}

/**
 * Get insights report
 * @returns {Promise<Object>} Insights report
 */
export async function getInsightsReport() {
    const web = await getKnowledgeWeb();
    return await web.generateInsightsReport();
}

/**
 * Get knowledge web statistics
 * @returns {Promise<Object>} Statistics
 */
export async function getKnowledgeWebStats() {
    const web = await getKnowledgeWeb();
    return web.getStats();
}

/**
 * Extracts all URLs from a given string of HTML content.
 * @param {string} htmlContent - The HTML content to parse.
 * @returns {Array<string>|null} An array of URLs or null if no matches.
 */
export function extractUrls(htmlContent) {
    if (!htmlContent) return [];
    const urlRegex = /https?:\/\/[^\s"<>]+/g;
    return htmlContent.match(urlRegex) || [];
}

/**
 * Fetches the content of a URL and parses it into a readable article.
 * This function now fetches directly instead of messaging the background script.
 * @param {string} url - The URL to fetch and parse.
 * @returns {Promise<Object>} An object indicating success and containing the content or an error.
 */
export async function fetchAndParseArticle(url) {
    try {
        const response = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const reader = new Readability(doc);
        const article = reader.parse();

        if (!article || !article.textContent) {
             throw new Error('Failed to parse article content with Readability.');
        }

        return { success: true, url, content: article.textContent.replace(/\s+/g, ' ').trim() };

    } catch (error) {
        console.error(`Failed to fetch or parse article at ${url}:`, error);
        return { success: false, url, error: error.message };
    }
} 