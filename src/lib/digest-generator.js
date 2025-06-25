/**
 * Digest generation and formatting
 */

import { fetchNewsletterEmails } from './gmail-api.js';
import {
    filterRelevantEmails,
    generateSummaryFromEmails,
    offscreenManager
} from './openai-handler.js';
import { getStoredPreferences } from './personalization.js';
import { addDigestToKnowledgeWeb, extractUrls, fetchAndParseArticle } from './knowledge-web.js';

/**
 * Generates a full digest of recent, relevant newsletters by orchestrating
 * the entire Fetch -> Pick -> Summarize pipeline.
 * @returns {Promise<Object>} The final, generated digest object.
 */
export async function generateDigest(period = '7d') {
    console.log('[Digest Generator] Starting digest generation for period:', period);
    try {
        await offscreenManager.setup();

        const [preferences, allEmails] = await Promise.all([
            getStoredPreferences(),
            fetchNewsletterEmails(period)
        ]);
        console.log(`[Digest Generator] Fetched ${allEmails.length} emails.`);
        if (allEmails.length === 0) {
            return { success: true, digest: "No new emails to digest in the last week." };
        }

        console.log('[Digest Generator] Filtering relevant emails...');
        const relevantEmails = await filterRelevantEmails(allEmails, preferences);
        console.log(`[Digest Generator] Relevant emails after filtering:`, relevantEmails);

        if (relevantEmails.length === 0) {
            console.log('[Digest Generator] No relevant emails found to generate a digest.');
            return { success: true, digest: "No relevant topics found in your recent emails. Your inbox is on top of things!" };
        }

        console.log(`[Digest Generator] Sending ${relevantEmails.length} relevant emails to AI for summarization...`);
        const summary = await generateSummaryFromEmails(relevantEmails, preferences);
        
        console.log('[Digest Generator] Digest generation complete.');
        return { success: true, digest: summary };

    } catch (error) {
        console.error('[Digest Generator] A critical error occurred:', error);
        return { success: false, error: error.message };
    } finally {
        console.log('[Digest Generator] Closing offscreen document.');
        await offscreenManager.close();
    }
}

/**
 * Generate a unique digest ID
 * @returns {string} Unique digest ID
 */
function generateDigestId() {
    return `digest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a digest from summarized emails
 * @param {Array} emails Array of summarized emails
 * @param {Object} preferences User preferences
 * @returns {Promise<Object>} Generated digest
 */
export async function generateDigestFromSummarizedEmails(emails, preferences) {
    try {
        console.log(`Generating digest from ${emails.length} emails`);
        
        // Filter out fallback summaries if we have enough good summaries
        const goodSummaries = emails.filter(email => !email.isFallback);
        const fallbackSummaries = emails.filter(email => email.isFallback);
        
        let summariesToProcess = emails;
        if (goodSummaries.length >= 3) {
            summariesToProcess = goodSummaries;
            console.log(`Using ${goodSummaries.length} good summaries, skipping ${fallbackSummaries.length} fallback summaries`);
        }
        
        // Rank and categorize content
        const rankedEmails = rankContent(summariesToProcess, preferences);
        const categorizedContent = categorizeContent(rankedEmails);
        
        // Generate digest structure
        const digest = {
            id: generateDigestId(),
            title: generateDigestTitle(preferences),
            date: new Date(),
            style: preferences.style,
            sections: generateSections(categorizedContent),
            stats: generateStats(rankedEmails),
            metadata: {
                totalEmails: emails.length,
                goodSummaries: goodSummaries.length,
                fallbackSummaries: fallbackSummaries.length,
                generationTime: new Date().toISOString()
            }
        };
        
        // Store digest
        await storeDigest(digest);
        
        console.log(`Digest generated successfully: ${digest.title}`);
        return digest;
    } catch (error) {
        console.error('Error generating digest:', error);
        throw new Error('Failed to generate digest');
    }
}

/**
 * Generate a title for the digest
 * @param {Object} preferences User preferences
 * @returns {string} Digest title
 */
function generateDigestTitle(preferences) {
    const date = new Date();
    const frequency = preferences.frequency;
    
    switch (frequency) {
        case 'daily':
            return `Daily Digest - ${date.toLocaleDateString()}`;
        case 'weekly':
            return `Weekly Digest - Week of ${date.toLocaleDateString()}`;
        case 'monthly':
            return `Monthly Digest - ${date.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
        default:
            return `Digest - ${date.toLocaleDateString()}`;
    }
}

/**
 * Generate digest sections from categorized content
 * @param {Object} categorizedContent Categorized content
 * @returns {Array} Digest sections
 */
function generateSections(categorizedContent) {
    return Object.entries(categorizedContent)
        .map(([category, items]) => ({
            title: formatCategoryTitle(category),
            items: items.map(item => ({
                title: item.title,
                source: item.source,
                date: item.date,
                summary: item.summary,
                score: item.score,
                isFallback: item.isFallback || false
            }))
        }))
        .sort((a, b) => b.items.length - a.items.length)
        .filter(section => section.items.length > 0); // Remove empty sections
}

/**
 * Format category title
 * @param {string} category Category name
 * @returns {string} Formatted title
 */
function formatCategoryTitle(category) {
    return category
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Generate digest statistics
 * @param {Array} emails Array of emails
 * @returns {Object} Digest statistics
 */
function generateStats(emails) {
    const validEmails = emails.filter(email => !email.isFallback);
    const totalScore = validEmails.reduce((sum, email) => sum + (email.score || 0), 0);
    
    return {
        totalItems: emails.length,
        averageScore: validEmails.length > 0 ? totalScore / validEmails.length : 0,
        topSources: getTopSources(emails),
        readingTime: calculateReadingTime(emails),
        qualityMetrics: {
            goodSummaries: validEmails.length,
            fallbackSummaries: emails.length - validEmails.length,
            averageQuality: validEmails.length > 0 ? (totalScore / validEmails.length) * 100 : 0
        }
    };
}

/**
 * Get top email sources
 * @param {Array} emails Array of emails
 * @returns {Array} Top sources
 */
function getTopSources(emails) {
    const sourceCount = emails.reduce((counts, email) => {
        const source = email.source || 'Unknown';
        counts[source] = (counts[source] || 0) + 1;
        return counts;
    }, {});
    
    return Object.entries(sourceCount)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([source, count]) => ({ source, count }));
}

/**
 * Calculate estimated reading time
 * @param {Array} emails Array of emails
 * @returns {number} Reading time in minutes
 */
function calculateReadingTime(emails) {
    const wordsPerMinute = 200;
    const totalWords = emails.reduce((sum, email) => {
        if (!email.summary) return sum;
        return sum + email.summary.split(/\s+/).length;
    }, 0);
    
    return Math.max(1, Math.ceil(totalWords / wordsPerMinute));
}

/**
 * Store generated digest
 * @param {Object} digest Digest to store
 * @returns {Promise<void>}
 */
async function storeDigest(digest) {
    try {
        // Get existing digests
        const { digests = [] } = await chrome.storage.sync.get('digests');
        
        // Add new digest
        digests.unshift(digest);
        
        // Keep only last 10 digests
        const trimmedDigests = digests.slice(0, 10);
        
        // Store updated digests
        await chrome.storage.sync.set({ digests: trimmedDigests });
        
        // Update last generated timestamp
        await chrome.storage.sync.set({ 
            lastGenerated: new Date().toISOString(),
            lastDigestId: digest.id
        });
        
        console.log(`Digest stored successfully: ${digest.id}`);
    } catch (error) {
        console.error('Error storing digest:', error);
        throw new Error('Failed to store digest');
    }
}

/**
 * Exports a digest to the specified format (html, md, txt).
 * @param {Object} digest - The digest object to export.
 * @param {string} format - The desired format ('html', 'markdown', 'text').
 * @returns {string} The formatted digest content.
 */
export function exportDigest(digest, format = 'html') {
    switch (format) {
        case 'html':
            return generateHTML(digest);
        case 'markdown':
            return generateMarkdown(digest);
        case 'text':
            return generateText(digest);
        default:
            return generateText(digest);
    }
}

/**
 * Generate HTML version of digest
 * @param {Object} digest Digest to convert
 * @returns {string} HTML string
 */
function generateHTML(digest) {
    const styles = `
        <style>
            body { font-family: sans-serif; line-height: 1.6; color: #333; }
            .digest-container { max-width: 800px; margin: 20px auto; padding: 20px; border: 1px solid #eee; }
            h1, h2, h3 { color: #222; }
            .section { margin-bottom: 2em; }
            .item { margin-bottom: 1.5em; padding-bottom: 1.5em; border-bottom: 1px solid #eee; }
            .item-title { font-size: 1.2em; font-weight: bold; }
            .item-meta { font-size: 0.9em; color: #666; margin-bottom: 0.5em; }
            .fallback-warning { color: #d9534f; font-style: italic; }
            .stats { margin-top: 2em; padding-top: 1em; border-top: 2px solid #333; }
        </style>
    `;

    const body = `
        <div class="digest-container">
            <h1>${digest.title}</h1>
            <p>Generated on ${new Date(digest.date).toLocaleString()}</p>

            ${digest.sections.map(section => `
                <div class="section">
                    <h2>${section.title}</h2>
                    ${section.items.map(item => `
                        <div class="item">
                            <div class="item-title">${item.title}</div>
                            <div class="item-meta">
                                <span>From: ${item.source}</span> | <span>${new Date(item.date).toLocaleDateString()}</span>
                            </div>
                            ${item.isFallback ? '<p class="fallback-warning">⚠️ Summary may be incomplete.</p>' : ''}
                            <div>${item.summary}</div>
                        </div>
                    `).join('')}
                </div>
            `).join('')}

            <div class="stats">
                <h3>Digest Statistics</h3>
                <ul>
                    <li>Total Items: ${digest.stats.totalItems}</li>
                    <li>Estimated Reading Time: ${digest.stats.readingTime} minutes</li>
                    <li>Top Source: ${digest.stats.topSources[0]?.source || 'N/A'}</li>
                </ul>
            </div>
        </div>
    `;

    return `<!DOCTYPE html><html><head><title>${digest.title}</title>${styles}</head><body>${body}</body></html>`;
}

/**
 * Generate Markdown version of digest
 * @param {Object} digest Digest to convert
 * @returns {string} Markdown string
 */
function generateMarkdown(digest) {
    return `# ${digest.title}

*Generated on ${new Date(digest.date).toLocaleString()}*

${digest.sections.map(section => `
## ${section.title}
${section.items.map(item => `
### ${item.title}
**From:** ${item.source} | **Date:** ${new Date(item.date).toLocaleDateString()}
${item.isFallback ? '> *⚠️ Summary may be incomplete due to an error.*' : ''}

${item.summary}
`).join('\n')}
`).join('\n')}

---
**Digest Statistics:**
- Total Items: ${digest.stats.totalItems}
- Reading Time: ${digest.stats.readingTime} minutes
- Top Source: ${digest.stats.topSources[0]?.source || 'N/A'}
`;
}

/**
 * Generate plain text version of digest
 * @param {Object} digest Digest to convert
 * @returns {string} Plain text string
 */
function generateText(digest) {
    return `${digest.title}

Generated on ${new Date(digest.date).toLocaleString()}

${digest.sections.map(section => `
${section.title}
${'='.repeat(section.title.length)}

${section.items.map(item => `
${item.title}
${item.source} • ${new Date(item.date).toLocaleDateString()}
${item.isFallback ? '⚠️ Summary generated from fallback due to API error' : ''}

${item.summary}
`).join('\n')}
`).join('\n')}

---
Digest Statistics:
- Total Items: ${digest.stats.totalItems}
- Reading Time: ${digest.stats.readingTime} minutes
- Top Source: ${digest.stats.topSources[0]?.source || 'N/A'}
`;
}
