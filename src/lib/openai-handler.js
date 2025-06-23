/**
 * OpenAI API integration for content summarization.
 * Implements a two-step process:
 * 1. Pick relevant emails from a list.
 * 2. Summarize the content of the picked emails into a cohesive digest.
 */

import { getStoredPreferences } from './personalization.js';
import { OPENAI_API_KEY } from './config.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
const API_KEY = OPENAI_API_KEY; // From config.js
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second base delay

/**
 * Initialize OpenAI client by retrieving the API key from storage.
 * @returns {Promise<string>} The user's OpenAI API key.
 */
export async function initializeOpenAI() {
    if (!API_KEY) {
        throw new Error("OpenAI API key is not configured. Please add it to src/lib/config.js.");
    }
    return API_KEY;
}

/**
 * Extracts the core text content from email HTML, focusing on the <tbody>.
 * @param {string} htmlString The raw HTML of the email.
 * @returns {string} The cleaned text content.
 */
export function cleanEmailContent(htmlString) {
    if (!htmlString) return { text: '', links: [] };
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        
        // Extract links
        const links = [...doc.querySelectorAll('a')]
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'));

        const mainContent = doc.querySelector('tbody') || doc.body;
        if (!mainContent) return { text: '', links: [] };
        
        let text = mainContent.textContent || '';
        
        const cleanedText = text
            .replace(/\s+/g, ' ') // Normalize whitespace
            .replace(/unsubscribe|view in browser|privacy policy/gi, '') // Remove common footer links
            .trim();

        return { text: cleanedText, links: [...new Set(links)] }; // Return unique links
    } catch (error) {
        console.error("Could not parse email HTML:", error);
        const textOnly = htmlString.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return { text: textOnly, links: [] };
    }
}

/**
 * Fetches the content from a list of URLs via the background script.
 * @param {string[]} urls - An array of URLs to fetch.
 * @returns {Promise<string>} A promise that resolves to the combined content of the pages.
 */
async function fetchContentFromUrls(urls) {
    if (!urls || urls.length === 0) {
        return "";
    }
    console.log(`Fetching content from ${urls.length} URLs...`);
    
    const contentPromises = urls.map(url => {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'FETCH_URL_CONTENT', url }, response => {
                if (chrome.runtime.lastError) {
                    console.error(`Error fetching ${url}:`, chrome.runtime.lastError.message);
                    resolve(""); // Resolve with empty string on error
                } else if (response && response.success) {
                    resolve(response.content);
                } else {
                    console.error(`Failed to fetch content for ${url}:`, response.error);
                    resolve(""); // Resolve with empty string on failure
                }
            });
        });
    });

    const contents = await Promise.all(contentPromises);
    return contents.join('\\n\\n'); // Join content from all pages
}

/**
 * Generates a prompt for the email picking LLM call.
 * @param {Array<Object>} emailMetadataList A list of email metadata ({ id, from, subject, snippet }).
 * @param {Object} preferences The user's preferences.
 * @returns {string} The generated prompt.
 */
function generateEmailPickerPrompt(emailMetadataList, preferences) {
    const { topics = [], instructions = '' } = preferences;

    const userInterests = topics.length > 0 
        ? `The user's primary interests are: ${topics.join(', ')}.`
        : 'The user has not specified any interests; focus on objectively important, non-promotional content.';

    const customInstructions = instructions 
        ? `Additionally, the user has provided these instructions: "${instructions}"`
        : '';
    
    const emailListString = emailMetadataList.map(email => 
        `ID: ${email.id}\nFrom: ${email.from}\nSubject: ${email.subject}\nSnippet: ${email.snippet}`
    ).join('\n---\n');

    return `You are an intelligent email filter for a user whose professional context is:
- Occupation: ${preferences.occupation}
- Currently working on: ${preferences.currentWork}
- Other interests: ${(preferences.topics || []).join(', ')}

Here is a list of their latest newsletter emails. Your task is to identify which emails are most relevant to their work and interests.
Focus on signals, not noise. Prioritize topics that align with their professional goals and current projects.

Analyze the following emails:
---
${emailListString}
---

Based on the user's profile, which emails should be included in their digest?
Please respond with ONLY a comma-separated list of the relevant email IDs, and nothing else.
For example: "id1,id2,id3"
`;
}

/**
 * Step 1: Pick the most relevant emails from a list using an LLM call.
 * @param {Array<Object>} emailMetadataList A list of all potential emails with their metadata.
 * @param {Object} preferences The user's preferences.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of selected email IDs.
 */
export async function pickRelevantEmails(emailMetadataList, preferences) {
    if (!emailMetadataList || emailMetadataList.length === 0) {
        return [];
    }
    
    try {
        const apiKey = await initializeOpenAI();
        const prompt = generateEmailPickerPrompt(emailMetadataList, preferences);

        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.2,
                response_format: { type: "json_object" }, // Enforce JSON output
            }),
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error during email picking: ${response.status}`);
        }

        const data = await response.json();
        const picked = JSON.parse(data.choices[0].message.content);
        return picked.pickedEmailIds || [];

    } catch (error) {
        console.error("Failed to pick relevant emails:", error);
        // Fallback: if picking fails, just select all emails to avoid a complete failure.
        return emailMetadataList.map(e => e.id);
    }
}

/**
 * Generates a sophisticated, modular prompt for the final summarization.
 * @param {string} aggregatedContent The combined content of all picked emails.
 * @param {Object} preferences User's preferences.
 * @returns {string} The generated prompt.
 */
function generateDigestPrompt(aggregatedContent, preferences) {
    const { topics = [], instructions = '' } = preferences;

    const topicFocus = topics.length > 0 
        ? `The user is particularly interested in these topics: ${topics.join(', ')}. Please pay special attention to news and insights related to them.`
        : 'The user has not specified any topics of interest. Please identify the most objectively important information.';

    const customInstructions = instructions 
        ? `Please also follow these specific user instructions: "${instructions}"`
        : '';

    return `You are an expert intelligence analyst creating a personalized news digest for a client.
Your client's professional context is:
- Occupation: ${preferences.occupation}
- Currently working on: ${preferences.currentWork}
- Other interests: ${(preferences.topics || []).join(', ')}

You have been provided with the full content of several newsletters. Your task is to synthesize this information into a single, cohesive digest. 
Do not just summarize each article one by one. Instead, connect themes, identify trends, and extract the most critical insights relevant to your client's work.

The client has requested the following level of detail: ${preferences.digestDetailedness}

Here is the content to analyze:
---
${aggregatedContent}
---

Please generate the digest in Markdown format. Structure your response with the following sections:
1.  **## Key Highlights** - A few bullet points summarizing the absolute most important information.
2.  **## Deep Dive** - A more detailed synthesis of the content, organized by theme.
3.  **## Action Items & Next Steps** - Suggest potential actions, further reading, or things to watch out for based on the content.
`;
}

/**
 * Step 2: Summarizes a large block of aggregated newsletter content.
 * @param {string} aggregatedContent The combined, cleaned content of all picked emails.
 * @param {Object} preferences The user's preferences for summarization.
 * @param {number} retryCount The current retry attempt.
 * @returns {Promise<string>} The final, structured summary in Markdown format.
 */
export async function summarizeAggregatedContent(aggregatedContent, preferences, retryCount = 0) {
    if (!aggregatedContent) {
        return "There was no content to summarize.";
    }

    try {
        const apiKey = await initializeOpenAI();
        const prompt = generateDigestPrompt(aggregatedContent, preferences);
        
        // Estimate cost for user awareness (optional display on frontend)
        const tokens = Math.ceil(prompt.length / 4);
        const cost = estimateCost(tokens);
        console.log(`Summarizing aggregated content. Estimated tokens: ${tokens}, Estimated cost: $${cost.toFixed(5)}`);
        
        const response = await fetch(OPENAI_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.5, // A balance for creative synthesis
                top_p: 1,
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`OpenAI API error: ${response.status} - ${errorData.error?.message || response.statusText}`);
        }

        const data = await response.json();
        const summary = data.choices[0].message.content.trim();
        
        // TODO: Update stats with tokens used from `data.usage`
        
        return summary;
    } catch (error) {
        console.error(`Error during summarization (attempt ${retryCount + 1}):`, error);
        
        if (retryCount < MAX_RETRIES) {
            const delay = Math.pow(2, retryCount) * RETRY_DELAY;
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return summarizeAggregatedContent(aggregatedContent, preferences, retryCount + 1);
        }
        
        console.error("Summarization failed after all retries.");
        return `Error: Could not generate digest. The summarization service failed after ${MAX_RETRIES + 1} attempts. Last error: ${error.message}`;
    }
}

/**
 * Estimates the cost of a summarization request for GPT-4o.
 * @param {number} tokens Number of tokens.
 * @returns {number} Estimated cost in USD.
 */
export function estimateCost(tokens) {
    const inputCostPerToken = 0.000005;  // $5.00 / 1M tokens
    const outputCostPerToken = 0.000015; // $15.00 / 1M tokens
    
    // Assume 70% input, 30% output for cost estimation
    const inputTokens = Math.floor(tokens * 0.7);
    const outputTokens = tokens - inputTokens;
    
    return (inputTokens * inputCostPerToken) + (outputTokens * outputCostPerToken);
}

/**
 * Gets summarization statistics from storage.
 * @returns {Promise<Object>} Statistics object.
 */
export async function getSummarizationStats() {
    const { stats = {} } = await chrome.storage.sync.get('stats');
    return {
        totalProcessed: stats.processed || 0,
        totalSaved: stats.saved || 0,
        totalCost: stats.totalCost || 0,
        averageCostPerEmail: stats.processed > 0 ? (stats.totalCost / stats.processed) : 0
    };
}

/**
 * Generates a prompt for summarizing a single email.
 * @param {string} emailContent The cleaned content of a single email.
 * @param {Object} preferences User's preferences.
 * @returns {string} The generated prompt.
 */
function generateSingleEmailSummaryPrompt(emailContent, preferences) {
    return `You are an expert assistant summarizing a single newsletter for a client.
Your client's professional context is:
- Occupation: ${preferences.occupation}
- Currently working on: ${preferences.currentWork}
- Key Interests: ${(preferences.topics || []).join(', ')}

Here is the email content:
---
${emailContent}
---

Please extract and summarize the most important points from this email that are relevant to the client's profile.
Focus on key takeaways, insights, and actionable information. Be concise.
`;
}

/**
 * Summarizes the content of a single email.
 * @param {Object} email The email object.
 * @param {Object} preferences The user's preferences.
 * @returns {Promise<string>} The summary of the single email.
 */
async function summarizeSingleEmail(email, preferences) {
    const cleaned = cleanEmailContent(email.body);
    if (!cleaned.text) {
        return ''; // Skip empty emails
    }

    const prompt = generateSingleEmailSummaryPrompt(cleaned.text, preferences);

    try {
        const response = await callOpenAI({
            model: DEFAULT_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            max_tokens: 500, // Limit output for single summary
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error(`Failed to summarize email from ${email.from}:`, error);
        return ''; // Return empty string on failure to not break the whole digest
    }
}

/**
 * Orchestrates the summarization of multiple emails using a map-reduce strategy.
 * @param {Array<Object>} emails Array of email objects with full content.
 * @param {Object} preferences User preferences.
 * @returns {Promise<string>} The final, structured summary in Markdown format.
 */
export async function generateSummaryFromEmails(emails, preferences) {
    if (!emails || emails.length === 0) {
        return "No emails were provided for summarization.";
    }

    try {
        console.log(`[OpenAI Handler] Starting multi-step summarization for ${emails.length} emails.`);

        // STEP 1: Summarize each email individually (Map)
        console.log('[OpenAI Handler] Step 1: Summarizing emails individually...');
        const summaryPromises = emails.map(email => summarizeSingleEmail(email, preferences));
        const individualSummaries = await Promise.all(summaryPromises);

        const validSummaries = individualSummaries.filter(s => s && s.trim() !== '');
        console.log(`[OpenAI Handler] Successfully generated ${validSummaries.length} individual summaries.`);

        if (validSummaries.length === 0) {
            return "Could not generate any summaries from the provided emails.";
        }
        
        if (validSummaries.length === 1) {
            return validSummaries[0];
        }

        // STEP 2: Combine individual summaries and create a final digest (Reduce)
        console.log('[OpenAI Handler] Step 2: Synthesizing final digest from individual summaries...');
        const aggregatedSummaries = validSummaries
            .map((summary, index) => `--- Summary of Email from: ${emails[index].from}, Subject: ${emails[index].subject} ---\n${summary}`)
            .join('\n\n');
        
        const finalDigest = await summarizeAggregatedContent(aggregatedSummaries, preferences);

        console.log("[OpenAI Handler] Successfully generated final digest.");
        return finalDigest;

    } catch (error) {
        console.error("An error occurred in the summarization orchestrator:", error);
        throw new Error(`Failed to process and summarize emails: ${error.message}`);
    }
}

/**
 * Makes a call to the OpenAI API with retry logic.
 * @param {Object} body The request body for the OpenAI API call.
 * @returns {Promise<Object>} The JSON response from the API.
 */
async function callOpenAI(body) {
    const apiKey = await initializeOpenAI();
    let lastError = null;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await fetch(OPENAI_API_URL, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (response.ok) {
                return await response.json();
            }

            const errorText = await response.text();
            lastError = new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
            
            if (response.status === 429) { // Rate limit
                const delay = RETRY_DELAY * Math.pow(2, i);
                console.warn(`Rate limit exceeded. Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw lastError; // For non-retriable errors
            }

        } catch (error) {
            lastError = error;
            if (i === MAX_RETRIES - 1) {
                console.error("OpenAI call failed after multiple retries:", lastError);
            }
        }
    }
    throw lastError;
} 