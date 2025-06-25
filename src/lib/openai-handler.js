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

const OFFSCREEN_DOCUMENT_PATH = '/src/lib/offscreen.html';
const PING_INTERVAL = 50; // ms
const PING_TIMEOUT = 5000; // 5 seconds

// Module-level state to prevent race conditions.
let isCreating = false;
let setupPromise = null;

/**
 * A robust manager for the offscreen document.
 * Ensures the document is created only once and is fully ready before resolving.
 */
export const offscreenManager = {
    async setup() {
        if (await chrome.offscreen.hasDocument()) {
            return;
        }

        // If another setup call is already in progress, wait for it to complete.
        if (isCreating && setupPromise) {
            return setupPromise;
        }

        isCreating = true;
        setupPromise = new Promise(async (resolve, reject) => {
            try {
                await chrome.offscreen.createDocument({
                    url: OFFSCREEN_DOCUMENT_PATH,
                    reasons: ['DOM_PARSER'],
                    justification: 'To parse HTML content from emails.',
                });

                // Wait for the document to be ready by pinging it.
                const success = await this.waitForReady();
                if (success) {
                    resolve();
                } else {
                    reject(new Error("Offscreen document timed out."));
                }
            } catch (error) {
                reject(error);
            } finally {
                isCreating = false;
                setupPromise = null;
            }
        });

        return setupPromise;
    },

    async waitForReady() {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                clearInterval(interval);
                resolve(false);
            }, PING_TIMEOUT);

            const interval = setInterval(async () => {
                try {
                    const response = await chrome.runtime.sendMessage({
                        type: 'ping',
                        target: 'offscreen'
                    });
                    if (response && response.pong) {
                        clearInterval(interval);
                        clearTimeout(timeout);
                        resolve(true);
                    }
                } catch (e) {
                    // Ignore "receiving end does not exist" errors while we wait.
                }
            }, PING_INTERVAL);
        });
    },

    async close() {
        if (await chrome.offscreen.hasDocument()) {
            await chrome.offscreen.closeDocument();
        }
    }
};

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
 * Extracts the core text content from email HTML by sending it to an offscreen document.
 * Assumes the document has already been created by the orchestrator.
 * @param {string} htmlString The raw HTML of the email.
 * @returns {Promise<{text: string, links: Array<string>}>} The cleaned text content and links.
 */
export async function cleanEmailContent(htmlString) {
    if (!htmlString) return { text: '', links: [] };

    try {
        const cleaned = await chrome.runtime.sendMessage({
            type: 'clean-html',
            target: 'offscreen',
            data: { htmlString },
        });
        return cleaned;
    } catch (error) {
        console.error("Error communicating with offscreen document:", error.message);
        // Fallback in case of messaging errors
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
    const cleaned = await cleanEmailContent(email.body);
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
 * Orchestrates the summarization of multiple emails by aggregating content and summarizing once.
 * @param {Array<Object>} emails Array of email objects with full content.
 * @param {Object} preferences User preferences.
 * @returns {Promise<string>} The final, structured summary in Markdown format.
 */
export async function generateSummaryFromEmails(emails, preferences) {
    if (!emails || emails.length === 0) {
        return "No emails were provided for summarization.";
    }

    try {
        console.log(`[OpenAI Handler] Starting single-pass summarization for ${emails.length} emails.`);

        // Clean and aggregate all email content at once
        console.log('[OpenAI Handler] Cleaning and aggregating email content...');
        const cleaningPromises = emails.map(email => cleanEmailContent(email.body));
        const cleanedContents = await Promise.all(cleaningPromises);

        // Combine all email content with headers
        const aggregatedContent = emails.map((email, index) => {
            const cleanedText = cleanedContents[index].text;
            if (!cleanedText || cleanedText.trim().length === 0) {
                console.warn(`[OpenAI Handler] No content extracted from email: ${email.subject}`);
                return '';
            }
            
            return `--- Email from: ${email.from}, Subject: ${email.subject} ---\n${cleanedText}`;
        }).filter(content => content.trim().length > 0).join('\n\n');

        if (!aggregatedContent || aggregatedContent.trim().length === 0) {
            return "Could not extract any meaningful content from the provided emails.";
        }

        console.log(`[OpenAI Handler] Aggregated ${aggregatedContent.length} characters of content from ${emails.length} emails.`);

        // Single summarization call with all content
        const finalDigest = await summarizeAggregatedContent(aggregatedContent, preferences);

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

/**
 * Generates a prompt to filter emails based on content snippets.
 * @param {Array<Object>} emailSnippets - Array of objects with { id, snippet }.
 * @param {Object} preferences - User's preferences.
 * @returns {string} The prompt for the LLM.
 */
function generateRelevanceFilterPrompt(emailSnippets, preferences) {
    const emailListString = emailSnippets
        .map(email => `--- Email ID: ${email.id} ---\n${email.snippet}...`)
        .join('\n\n');

    return `You are an expert intelligence analyst whose job is to build a personalized briefing for a client. Your client's profile is:
- Occupation: ${preferences.occupation}
- Currently working on: ${preferences.currentWork}
- Key Topics: ${(preferences.topics || []).join(', ')}

CRITICAL: Your default should be to INCLUDE emails unless they are clearly irrelevant. When in doubt, include the email. Think broadly about connections and themes.

Your goal is to cast a wide net and identify emails with ANY substantive content that could be relevant to the user's interests. Think about:

1. DIRECT RELEVANCE: Content explicitly about the user's topics
2. ADJACENT TOPICS: Related fields, complementary skills, industry context
3. BROADER ECOSYSTEM: Market trends, funding, people, companies in related spaces
4. EMERGING THEMES: New technologies, methodologies, or trends that could impact the user's work

Examples of what to INCLUDE:
- If user is interested in "AI": include machine learning, data science, automation, coding tools, developer productivity, tech industry news, startup funding, research papers
- If user is interested in "startups": include venture capital, entrepreneurship, business strategy, market analysis, founder stories, tech trends
- Content about people, companies, or technologies in the user's broader ecosystem
- Educational content, tutorials, or insights that could enhance the user's knowledge
- Industry analysis, market reports, or trend discussions
- Job opportunities, networking events, or professional development

Only EXCLUDE emails that are clearly:
- Transactional (receipts, shipping, verification codes, password resets)
- Pure spam or promotional offers with no informational value
- Personal correspondence unrelated to professional interests
- System notifications or automated alerts

Remember: The snippets below contain samples from the BEGINNING, MIDDLE, and END of each email (marked with [middle] and [end] indicators). Even if relevant keywords only appear in the middle or end sections, the email could still be highly valuable. Look for any indicators of relevance throughout all parts of the snippet.

---
SNIPPETS:
${emailListString}
---

Respond with a JSON object containing a single key "emailDecisions". This key should hold an array of objects, where each object has three keys: "id" (the email ID), "include" (a boolean true/false), and "reason" (a brief explanation, under 20 words, for your decision).

Example:
{
  "emailDecisions": [
    { "id": "id1", "include": true, "reason": "Contains AI industry insights and trends." },
    { "id": "id2", "include": false, "reason": "Transactional shipping notification." }
  ]
}
`;
}

/**
 * Uses an LLM to filter a list of emails down to the most relevant ones based on content snippets.
 * @param {Array<Object>} emails - The full email objects to filter.
 * @param {Object} preferences - The user's preferences.
 * @returns {Promise<Array<Object>>} A promise that resolves to the filtered list of full email objects.
 */
export async function filterRelevantEmails(emails, preferences) {
    if (!emails || emails.length === 0) {
        return [];
    }
    console.log(`[OpenAI Handler] Starting relevance filtering for ${emails.length} emails.`);

    // Create snippets from email bodies using smart sampling strategy
    const emailCleaningPromises = emails.map(email => cleanEmailContent(email.body));
    const cleanedContents = await Promise.all(emailCleaningPromises);

    console.log('[OpenAI Handler] Sample cleaned content:', cleanedContents.slice(0, 2));

    const emailSnippets = emails.map((email, index) => {
        const words = cleanedContents[index].text.split(/\s+/).filter(w => w.trim().length > 0);
        
        let snippet = '';
        
        if (words.length <= 100) {
            // If short enough, use the whole thing
            snippet = words.join(' ');
        } else {
            // Smart sampling: beginning + middle/end sections
            const beginningWords = words.slice(0, 50); // First 50 words
            
            // For the remaining 50 words, sample from middle and end
            const remainingWords = words.slice(50);
            const midPoint = Math.floor(remainingWords.length / 2);
            
            // Take 25 words from middle section and 25 from later section
            const middleWords = remainingWords.slice(midPoint - 12, midPoint + 13); // 25 words around midpoint
            const endWords = remainingWords.slice(-25); // Last 25 words
            
            // Combine with separators to indicate sampling
            snippet = [
                beginningWords.join(' '),
                '... [middle] ...',
                middleWords.join(' '),
                '... [end] ...',
                endWords.join(' ')
            ].join(' ');
        }
        
        console.log(`[OpenAI Handler] Email ${email.id} smart snippet (${words.length} words total, sampled ${snippet.split(/\s+/).length} words):`, snippet.substring(0, 300) + '...');
        return {
            id: email.id,
            snippet: snippet,
        };
    });

    const prompt = generateRelevanceFilterPrompt(emailSnippets, preferences);

    try {
        const response = await callOpenAI({
            model: DEFAULT_MODEL,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            response_format: { type: "json_object" },
        });

        const content = JSON.parse(response.choices[0].message.content);
        const decisions = content.emailDecisions || [];

        // Log the AI's reasoning for inspection with email titles
        console.log("[OpenAI Handler] AI Filtering Decisions:");
        decisions.forEach(decision => {
            const email = emails.find(e => e.id === decision.id);
            const emailTitle = email ? email.subject : 'Unknown';
            console.log(`  ${decision.include ? '✓' : '✗'} [${decision.id}] "${emailTitle}" - ${decision.reason}`);
        });
        
        const relevantIds = new Set(
            decisions.filter(d => d.include).map(d => d.id)
        );
        
        const filteredEmails = emails.filter(email => relevantIds.has(email.id));
        console.log(`[OpenAI Handler] Finished relevance filtering. Found ${filteredEmails.length} relevant emails.`);
        return filteredEmails;

    } catch (error) {
        console.error("Failed to filter emails with LLM:", error);
        // Fallback: If filtering fails, return the original list to avoid interrupting the flow.
        return emails;
    }
} 