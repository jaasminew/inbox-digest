/**
 * Debug testing system for email extraction and filtering algorithm
 * Tests the accuracy of email filtering without LLM summarization
 */

import { filterRelevantEmails, offscreenManager, cleanEmailContent, getOpenAIApiKey } from './openai-handler.js';
import { getStoredPreferences } from './personalization.js';

const GMAIL_API_ROOT = 'https://www.googleapis.com/gmail/v1/users/me';

/**
 * Gets a Google Auth token for the user.
 * @returns {Promise<string>} The auth token.
 */
async function getAuthToken() {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(token);
            }
        });
    });
}

/**
 * Fetch emails from updates category with pagination
 * @param {number} maxResults Number of emails to fetch
 * @param {string} pageToken Page token for pagination
 * @returns {Promise<Object>} Response with messages and nextPageToken
 */
async function fetchUpdatesEmails(maxResults = 20, pageToken = null) {
    try {
        const token = await getAuthToken();
        const query = 'category:updates';
        
        let url = `${GMAIL_API_ROOT}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }

        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });

        if (!response.ok) {
            throw new Error(`Gmail API error: ${response.statusText}`);
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching emails:', error);
        throw error;
    }
}

/**
 * Fetch detailed information for a specific email
 * @param {string} messageId Gmail message ID
 * @param {string} token Auth token
 * @returns {Promise<Object>} Email details
 */
async function fetchEmailDetails(messageId, token) {
    try {
        const response = await fetch(
            `${GMAIL_API_ROOT}/messages/${messageId}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch email details: ${response.statusText}`);
        }

        const data = await response.json();
        return processEmailData(data);
    } catch (error) {
        console.error('Error fetching email details:', error);
        throw error;
    }
}

/**
 * Process raw email data into a structured format
 * @param {Object} emailData Raw email data from Gmail API
 * @returns {Object} Processed email object
 */
function processEmailData(emailData) {
    const headers = emailData.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const from = headers.find(h => h.name === 'From')?.value || '';
    const dateString = headers.find(h => h.name === 'Date')?.value || '';

    // Handle date parsing with fallback
    let date;
    try {
        if (dateString) {
            date = new Date(dateString);
            // Check if date is valid
            if (isNaN(date.getTime())) {
                console.warn(`Invalid date for email ${emailData.id}: ${dateString}`);
                date = new Date(); // Use current date as fallback
            }
        } else {
            date = new Date(); // Use current date if no date header
        }
    } catch (error) {
        console.warn(`Error parsing date for email ${emailData.id}: ${dateString}`, error);
        date = new Date(); // Use current date as fallback
    }

    let body = '';
    if (emailData.payload.parts) {
        const htmlPart = emailData.payload.parts.find(part => part.mimeType === 'text/html');
        if (htmlPart && htmlPart.body.data) {
            body = atob(htmlPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        }
    } else if (emailData.payload.body.data) {
        body = atob(emailData.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }

    return {
        id: emailData.id,
        subject,
        from,
        date,
        body,
        snippet: emailData.snippet
    };
}

/**
 * Common boilerplate patterns to filter out from email content
 */
const BOILERPLATE_PATTERNS = [
    // Subscription and unsubscribe
    /\b(click|tap)\s+(here\s+)?to\s+(unsubscribe|subscribe|view|read|continue|download|access|sign\s+up|log\s+in|update)\b/gi,
    /\bunsubscribe\s+(here|from|link|at|instantly|now)\b/gi,
    /\bview\s+(this\s+)?(email\s+)?(in\s+)?(your\s+)?browser\b/gi,
    /\bif\s+you\s+(can't|cannot)\s+(see|view|read)\s+this\s+email/gi,
    /\bhaving\s+trouble\s+(viewing|reading)\s+this\s+email/gi,
    
    // Privacy and legal
    /\b(privacy\s+policy|terms\s+(of\s+)?(service|use)|cookie\s+policy|data\s+protection)\b/gi,
    /\breview\s+our\s+(privacy|terms|policy)/gi,
    /\bthis\s+email\s+was\s+sent\s+to\b/gi,
    /\byou\s+(are\s+)?receiving\s+this\s+(email\s+)?because\b/gi,
    /\bto\s+ensure\s+delivery\s+to\s+your\s+inbox/gi,
    
    // Social media and sharing
    /\b(follow|like|share)\s+us\s+on\s+(facebook|twitter|linkedin|instagram|youtube)\b/gi,
    /\bconnect\s+with\s+us\s+on\s+social\s+media\b/gi,
    /\bshare\s+this\s+(email|newsletter|article)\b/gi,
    
    // Technical/formatting
    /\bif\s+you\s+(prefer|want)\s+to\s+receive\s+(html|text)\s+emails/gi,
    /\badd\s+(us\s+)?to\s+your\s+(address\s+book|contacts|safe\s+senders)/gi,
    /\bto\s+ensure\s+you\s+continue\s+to\s+receive\s+our\s+emails/gi,
    /\bthis\s+is\s+an\s+automated\s+(email|message|notification)/gi,
    /\bdo\s+not\s+reply\s+to\s+this\s+email/gi,
    /\bnoreply@/gi,
    
    // Common CTA phrases without context
    /\b(click|tap|visit|go\s+to|check\s+out|learn\s+more|read\s+more|see\s+more|find\s+out|discover)\s+(here|now|today)\b/gi,
    /\b(get\s+)?(started|access|your|the)\s+(free|now|today|here)\b/gi,
    
    // Footer content
    /\bcopyright\s+\d{4}/gi,
    /\ball\s+rights\s+reserved/gi,
    /\bthis\s+email\s+is\s+(confidential|proprietary)/gi,
    /\bif\s+you\s+received\s+this\s+email\s+in\s+error/gi,
    
    // Newsletter specific
    /\bforwarded\s+by\s+a\s+friend/gi,
    /\bwas\s+this\s+email\s+forwarded\s+to\s+you/gi,
    /\bsubscribe\s+to\s+(get|receive)\s+(more|our|this)/gi,
    /\bemail\s+preferences\s+(center|page)/gi,
    
    // Forward/Subscribe patterns
    /\byou\s+received\s+this\s+newsletter\s+from\s+someone\s+else,?\s*subscribe\s+here/gi,
    /\bforwarded\s+this\s+email\?\s*subscribe\s+here\s+(for\s+more)?/gi,
    /\bone\s+(of\s+)?the\s+benefits?\s+(of\s+)?subscribing\s+(to\s+)?(the\s+)?[\w\s]+/gi,
    /\bif\s+you\s+received\s+this\s+(email\s+)?from\s+(a\s+friend|someone)/gi,
    /\bsubscribe\s+(here|now)\s+(for\s+)?(more|to\s+get|to\s+receive)/gi,
    
    // Additional subscription/forwarding patterns
    /\bget\s+this\s+newsletter\s+(delivered\s+)?(directly\s+)?to\s+your\s+inbox/gi,
    /\bwant\s+to\s+(receive|get)\s+this\s+newsletter/gi,
    /\bsubscribe\s+to\s+(our\s+)?(free\s+)?newsletter/gi,
    /\bjoin\s+(our\s+)?\d+[k+]?\s+(subscribers?|readers?)/gi,
    /\bbecome\s+a\s+(free\s+)?(subscriber|member)/gi,
    /\bsign\s+up\s+(for\s+)?(our\s+)?(free\s+)?newsletter/gi,
];

/**
 * Remove boilerplate text from email content
 * @param {string} text Email text content
 * @returns {string} Cleaned text with boilerplate removed
 */
function removeBoilerplateText(text) {
    if (!text) return '';
    
    let cleanedText = text;
    
    // Apply all boilerplate pattern filters
    BOILERPLATE_PATTERNS.forEach(pattern => {
        cleanedText = cleanedText.replace(pattern, ' ');
    });
    
    // Remove common standalone phrases (case insensitive)
    const standalonePatterns = [
        'click here', 'tap here', 'learn more', 'read more', 'see more',
        'get started', 'sign up', 'log in', 'download now', 'access now',
        'view online', 'view in browser', 'unsubscribe', 'privacy policy',
        'terms of service', 'follow us', 'share this', 'forward to a friend',
        'add to contacts', 'safe senders', 'whitelist', 'manage preferences',
        'email preferences', 'subscription center', 'update profile',
        'copyright', 'all rights reserved', 'confidential', 'proprietary',
        'subscribe here', 'forwarded this email', 'benefits of subscribing',
        'received this newsletter', 'from someone else', 'subscribe now',
        'subscribe today', 'get this newsletter', 'join our newsletter'
    ];
    
    standalonePatterns.forEach(phrase => {
        const regex = new RegExp(`\\b${phrase}\\b`, 'gi');
        cleanedText = cleanedText.replace(regex, ' ');
    });
    
    // Clean up extra whitespace
    cleanedText = cleanedText.replace(/\s+/g, ' ').trim();
    
    return cleanedText;
}

/**
 * Extract meaningful content words, prioritizing substantive content
 * @param {string} text Cleaned email text
 * @returns {Array<string>} Array of meaningful words
 */
function extractMeaningfulWords(text) {
    if (!text) return [];
    
    const words = text.split(/\s+/).filter(word => word.length > 0);
    
    // Filter out very short words and common stop words that don't add value
    const meaningfulWords = words.filter(word => {
        // Keep words that are 3+ characters OR are important short words
        if (word.length >= 3) return true;
        
        // Keep important short words
        const importantShortWords = ['AI', 'ML', 'VR', 'AR', 'UX', 'UI', 'HR', 'PR', 'SEO', 'API', 'CEO', 'CTO', 'CFO'];
        return importantShortWords.includes(word.toUpperCase());
    });
    
    return meaningfulWords;
}

/**
 * Extract relevant links from email HTML based on anchor text
 * @param {string} htmlString Email HTML content
 * @returns {Promise<Array<Object>>} Array of relevant links with text and URL
 */
async function extractRelevantLinks(htmlString) {
    if (!htmlString) return [];
    
    try {
        // Send HTML to offscreen document for parsing
        const result = await chrome.runtime.sendMessage({
            type: 'extract-links',
            target: 'offscreen',
            data: { htmlString },
        });
        
        if (result && result.links) {
            return filterRelevantLinks(result.links);
        }
        
        return [];
    } catch (error) {
        console.error('Error extracting links:', error);
        return [];
    }
}

/**
 * Filter links to keep only those that appear relevant based on anchor text
 * @param {Array<Object>} links Array of {text, url} objects
 * @returns {Array<Object>} Filtered array of relevant links
 */
function filterRelevantLinks(links) {
    if (!links || links.length === 0) return [];
    
    // Helper function to normalize URLs by removing tracking parameters
    function normalizeUrl(url) {
        try {
            const urlObj = new URL(url);
            
                    console.log(`[URL Normalize] Original: ${url.substring(0, 150)}...`);
        
        // Remove ALL query parameters for better deduplication
        // Most newsletter links are the same article with different tracking
        urlObj.search = '';
        
        // Also normalize the hash/fragment
        urlObj.hash = '';
        
        const normalized = urlObj.toString();
        console.log(`[URL Normalize] Normalized: ${normalized}`);
            
            return normalized;
        } catch (error) {
            console.log(`[URL Normalize] Failed to parse URL: ${error.message}`);
            // If URL parsing fails, return original URL
            return url;
        }
    }
    
    // Patterns for irrelevant link text (promotional/boilerplate)
    const irrelevantPatterns = [
        /^(click|tap|view|see|get|download|access|sign|log|subscribe|unsubscribe|manage|update|share|follow|like|join)\s/i,
        /^(here|now|today|all|full|complete|entire|details|info|information)\s*$/i,
        /^(privacy|terms|policy|legal|copyright|contact|about|help|support|faq)$/i,
        /\b(preferences|settings|profile|account|subscription|newsletter|email)\b/i,
        /^(facebook|twitter|linkedin|instagram|youtube|social)$/i,
        /^(forward|share|send|tell|invite)\b/i,
        /\b(advertisement|ad|promo|promotion|offer|deal|sale|discount)\b/i,
        /^(©|®|™|\d{4}|\w+@\w+)/i,
        // Promotional service patterns - even if they mention company names
        /\b(channel|playlist|stream|streaming|listen|watch|download|install|try|free trial|get started|sign up|join)\b/i,
        /\b(app store|play store|download now|available now|get it|try it|use it|do it here)\b/i,
        /^(youtube channel|spotify|apple music|netflix|amazon prime|disney\+|hulu|twitch stream|instagram page|facebook page|twitter account|linkedin profile)$/i,
        /\b(follow us|like us|subscribe to|join our|visit our|check out our)\b/i,
        // Feedback/engagement/survey patterns
        /\b(i liked it|i didn't like it|i like it|i don't like it|liked it|didn't like it|like this|don't like|thumbs up|thumbs down)\b/i,
        /\b(rate this|rating|feedback|survey|poll|vote|comment|reply|respond|review this|tell us|let us know)\b/i,
        /\b(yes|no|maybe|agree|disagree|👍|👎|😊|😢|⭐|★|💯|🔥|❤️|💖|👏|🙌)\b/i,
        /^(good|bad|great|terrible|awesome|amazing|love|hate|meh|okay|ok)$/i,
        // Administrative/promotional newsletter patterns
        /\b(track your referrals|referral|advertise|advertisement|sponsor|sponsored|jobs|careers|hiring|resume)\b/i,
        /\b(if your company is interested|reaching an audience|decision makers|send a friend|job posting|career opportunity)\b/i,
        /\b(unsubscribe|manage preferences|email preferences|subscription|newsletter settings|privacy policy|terms of service)\b/i,
        /\b(contact us|about us|our team|our company|our mission|support|help center|customer service)\b/i,
    ];
    
    // Patterns for relevant link text (content-focused)
    const relevantIndicators = [
        /\b(article|report|study|research|analysis|survey|whitepaper|guide|tutorial|course|webinar|podcast|video|interview|news|announcement|launch|release|update|review|opinion|blog|post)\b/i,
        /\b(startup|company|funding|investment|venture|capital|IPO|acquisition|merger|partnership|collaboration|Meta|Google|Apple|Microsoft|Amazon|OpenAI|Anthropic|Tesla|Netflix|Uber|Airbnb|Cursor|Figma|Perplexity|GitHub|GitLab|Notion|Slack|Discord|Zoom|Salesforce|Adobe|Nvidia|Intel|AMD|Qualcomm|SpaceX|Stripe|PayPal|Square|Shopify|Atlassian|Dropbox|Box|Cloudflare|Vercel|MongoDB|Redis|Docker|Kubernetes|AWS|Azure|GCP|Snowflake|Databricks|Palantir|Unity|Epic|Roblox|TikTok|Twitter|X|LinkedIn|Instagram|WhatsApp|Telegram|Signal|Spotify|YouTube|Twitch|Reddit|Pinterest|Snapchat|ByteDance|Tencent|Alibaba|Baidu|Samsung|Sony|LG|Huawei|Xiaomi|OnePlus|Coinbase|Binance|Robinhood|Plaid|Affirm|Klarna|DoorDash|Instacart|Lyft|Waymo|Cruise|Rivian|Lucid|NIO|BYD|Canva|Miro|Linear|Airtable|Zapier|Mailchimp|HubSpot|Zendesk|Intercom|Twilio|SendGrid|Okta|Auth0|Supabase|Firebase|PlanetScale|Hasura|Prisma|Next\.js|React|Vue|Angular|Svelte|Tailwind|Bootstrap|WordPress|Wix|Squarespace|Webflow|Framer)\b/i,
        /\b(AI|artificial\s+intelligence|machine\s+learning|ML|reinforcement\s+learning|deep\s+learning|data\s+science|automation|technology|tech|innovation|digital|software|platform|tool|app|product|service|techniques|developers|embedding|reranker|RAG|retrieval|semantic\s+search|vector|transformer|LLM|GPT|model|algorithm|neural\s+network|pioneer|researcher)\b/i,
        /\b(CEO|founder|executive|leader|expert|scientist|researcher|engineer|developer|designer|recruits|hires|hiring|joins)\b/i,
        /\b(conference|event|summit|meetup|workshop|hackathon|demo|presentation|talk|keynote)\b/i,
        /\b(market|industry|trend|growth|strategy|business|finance|economy|economic|investment)\b/i,
    ];
    
    // First pass: filter for relevance
    const relevantLinks = links.filter(link => {
        const linkText = link.text.trim();
        
        // Debug logging for problematic links
        const isMetaOpenAI = linkText.toLowerCase().includes('meta') && linkText.toLowerCase().includes('openai');
        const isFigma = linkText.toLowerCase().includes('figma');
        const isDebugLink = isMetaOpenAI || isFigma;
        
        if (isDebugLink) {
            console.log(`[Link Debug] Processing link: "${linkText}"`);
            if (isFigma) console.log('[Link Debug] This is a Figma link');
            if (isMetaOpenAI) console.log('[Link Debug] This is a Meta/OpenAI link');
        }
        
        // Skip very short or empty link text
        if (linkText.length < 3) {
            if (isDebugLink) console.log('[Link Debug] Skipped: too short');
            return false;
        }
        
        // Skip if matches irrelevant patterns
        const matchedIrrelevant = irrelevantPatterns.find(pattern => pattern.test(linkText));
        if (matchedIrrelevant) {
            if (isDebugLink) console.log(`[Link Debug] Skipped: matched irrelevant pattern: ${matchedIrrelevant}`);
            return false;
        }
        
        // Include if matches relevant indicators
        const matchedRelevant = relevantIndicators.find(pattern => pattern.test(linkText));
        if (matchedRelevant) {
            if (isDebugLink) console.log(`[Link Debug] Included: matched relevant pattern: ${matchedRelevant}`);
            return true;
        }
        
        // Include if link text is substantive (longer descriptive text)
        const words = linkText.split(/\s+/);
        if (words.length >= 3 && words.length <= 30) { // Increased from 20 to 30 words to accommodate longer technical descriptions
            // Check if it's not just generic phrases
            const genericPhrases = ['click here', 'learn more', 'see more', 'get started', 'sign up', 'log in'];
            // Allow "read more" if it's part of a longer substantive description
            const isGeneric = genericPhrases.some(phrase => linkText.toLowerCase().trim() === phrase);
            if (!isGeneric) {
                if (isDebugLink) console.log(`[Link Debug] Included: substantive text (${words.length} words)`);
                return true;
            } else {
                if (isDebugLink) console.log(`[Link Debug] Skipped: generic phrase detected`);
            }
        } else {
            if (isDebugLink) console.log(`[Link Debug] Skipped: word count ${words.length} outside range 3-30`);
        }
        
        if (isDebugLink) console.log('[Link Debug] Skipped: no matching criteria');
        return false;
    });
    
    // Second pass: deduplicate based on normalized URL only (ignore text variations)
    const seenUrls = new Set();
    const deduplicatedLinks = [];
    
    for (const link of relevantLinks) {
        // Use the processed URL first, then fall back to href
        const originalUrl = link.url || link.href || '';
        const normalizedUrl = normalizeUrl(originalUrl);
        const linkText = link.text.trim();
        
        console.log(`[Link Dedup] Processing: "${linkText.substring(0, 50)}..."`);
        console.log(`[Link Dedup] Original URL: ${originalUrl.substring(0, 100)}...`);
        console.log(`[Link Dedup] Normalized URL: ${normalizedUrl}`);
        
        // Use only normalized URL as the key (ignore text variations)
        // This catches cases where same article has slightly different extracted text
        if (!seenUrls.has(normalizedUrl)) {
            seenUrls.add(normalizedUrl);
            deduplicatedLinks.push(link);
            console.log(`[Link Dedup] ✅ Added unique link`);
        } else {
            console.log(`[Link Dedup] ❌ Skipped duplicate URL`);
        }
    }
    
    return deduplicatedLinks; // No limit - include all relevant links
}

/**
 * Extract ~100 words from different places in email body, filtering out boilerplate
 * @param {string} htmlBody Email HTML body
 * @returns {Promise<string>} Extracted text snippet with boilerplate removed
 */
async function extractEmailSnippet(htmlBody) {
    if (!htmlBody) return '';
    
    try {
        const cleaned = await cleanEmailContent(htmlBody);
        let text = cleaned.text;
        
        if (!text) return '';
        
        // Remove boilerplate text first
        const originalLength = text.split(/\s+/).length;
        text = removeBoilerplateText(text);
        const cleanedLength = text.split(/\s+/).length;
        
        console.log(`[Content Filter] Email ${htmlBody.substring(0, 50)}... - Removed ${originalLength - cleanedLength} boilerplate words (${originalLength} → ${cleanedLength})`);
        
        if (!text) return '';
        
        // Extract meaningful words
        const words = extractMeaningfulWords(text);
        
        if (words.length <= 100) {
            return words.join(' ');
        }
        
        // Smart extraction strategy: prioritize beginning and middle over end
        // (end often contains more boilerplate)
        const beginning = words.slice(0, 50).join(' '); // First 50 words
        const middle = words.slice(Math.floor(words.length * 0.3), Math.floor(words.length * 0.3) + 35).join(' '); // 35 words from 30% point
        const laterContent = words.slice(Math.floor(words.length * 0.6), Math.floor(words.length * 0.6) + 15).join(' '); // 15 words from 60% point
        
        return `${beginning} ... [middle] ... ${middle} ... [later] ... ${laterContent}`;
    } catch (error) {
        console.error('Error extracting email snippet:', error);
        // Fallback: basic HTML stripping with boilerplate removal
        const basicText = htmlBody.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const cleanedFallback = removeBoilerplateText(basicText);
        return cleanedFallback.substring(0, 500);
    }
}

/**
 * Custom filtering function that captures AI decisions
 * @param {Array} emails Array of emails to filter
 * @param {Object} preferences User preferences
 * @returns {Promise<Object>} Object with filtered emails and decisions
 */
async function filterEmailsWithDecisions(emails, preferences) {
    if (!emails || emails.length === 0) {
        return { filteredEmails: [], decisions: [] };
    }

    console.log(`[Debug Filter] Starting relevance filtering for ${emails.length} emails.`);

    // Create snippets from email bodies using smart sampling strategy
    const emailCleaningPromises = emails.map(email => cleanEmailContent(email.body));
    const cleanedContents = await Promise.all(emailCleaningPromises);

    const emailSnippets = emails.map((email, index) => {
        let text = cleanedContents[index].text;
        
        // Remove boilerplate text first
        const originalLength = text.split(/\s+/).length;
        text = removeBoilerplateText(text);
        const cleanedLength = text.split(/\s+/).length;
        
        console.log(`[Filter Content] Email ${email.id} - Removed ${originalLength - cleanedLength} boilerplate words (${originalLength} → ${cleanedLength})`);
        
        if (!text) {
            // Even if no content, include the subject (NO LINKS in filtering stage)
            return {
                id: email.id,
                snippet: `Subject: ${email.subject || 'No Subject'} | Content: No meaningful content extracted`,
            };
        }
        
        // Extract meaningful words from content
        const words = extractMeaningfulWords(text);
        
        // Prepare email subject (clean and limit length)
        const emailSubject = email.subject || 'No Subject';
        const subjectWords = emailSubject.split(/\s+/).slice(0, 10); // Limit subject to 10 words max
        
        let contentSnippet = '';
        
        if (words.length <= 80) {
            // Reserve ~20 words for subject, use remaining for content
            contentSnippet = words.join(' ');
        } else {
            // Smart extraction strategy: prioritize beginning and middle over end
            const beginning = words.slice(0, 40).join(' '); // First 40 words
            const middle = words.slice(Math.floor(words.length * 0.3), Math.floor(words.length * 0.3) + 25).join(' '); // 25 words from 30% point
            const laterContent = words.slice(Math.floor(words.length * 0.6), Math.floor(words.length * 0.6) + 15).join(' '); // 15 words from 60% point
            
            contentSnippet = `${beginning} ... [middle] ... ${middle} ... [later] ... ${laterContent}`;
        }
        
        // Combine subject and content ONLY (NO LINKS in filtering stage)
        const combinedSnippet = `Subject: ${subjectWords.join(' ')} | Content: ${contentSnippet}`;
        
        return {
            id: email.id,
            snippet: combinedSnippet,
        };
    });

    // Generate the prompt with subject + content format
    const emailListString = emailSnippets
        .map(email => `--- Email ID: ${email.id} ---\n${email.snippet}`)
        .join('\n\n');

    const prompt = `You are an expert intelligence analyst whose job is to build a personalized briefing for a client. Your client's profile is:
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

Remember: Each snippet below contains the EMAIL SUBJECT and samples from the BEGINNING, MIDDLE, and END of the email content (marked with [middle] and [later] indicators). Pay attention to both the subject line and content - often the subject provides crucial context for understanding relevance. Even if relevant keywords only appear in the middle or later sections, the email could still be highly valuable.

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

    try {
        // Get API key from storage
        const apiKey = await getOpenAIApiKey();
        if (!apiKey) {
            throw new Error('OpenAI API key not found');
        }

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                response_format: { type: "json_object" },
            })
        });

        const result = await response.json();
        const content = JSON.parse(result.choices[0].message.content);
        const decisions = content.emailDecisions || [];

        // Log the AI's reasoning for inspection
        console.log("[Debug Filter] AI Filtering Decisions:");
        decisions.forEach(decision => {
            const email = emails.find(e => e.id === decision.id);
            const emailTitle = email ? email.subject : 'Unknown';
            console.log(`  ${decision.include ? '✓' : '✗'} [${decision.id}] "${emailTitle}" - ${decision.reason}`);
        });
        
        const relevantIds = new Set(
            decisions.filter(d => d.include).map(d => d.id)
        );
        
        const filteredEmails = emails.filter(email => relevantIds.has(email.id));
        
        return { filteredEmails, decisions };

    } catch (error) {
        console.error("Failed to filter emails with LLM:", error);
        return { filteredEmails: emails, decisions: [] };
    }
}

/**
 * Run debug test for email filtering
 * @returns {Promise<Array>} Array of test results for 10 runs
 */
export async function runEmailFilterDebugTest() {
    console.log('Starting email filter debug test...');
    
    try {
        await offscreenManager.setup();
        
        const preferences = await getStoredPreferences();
        const allRunResults = [];
        let pageToken = null;
        
        for (let run = 1; run <= 2; run++) {
            try {
                console.log(`Running test ${run}/2...`);
                
                // Fetch 20 emails for this run
                const emailsResponse = await fetchUpdatesEmails(20, pageToken);
                
                if (!emailsResponse.messages || emailsResponse.messages.length === 0) {
                    console.log(`No more emails available at run ${run}`);
                    break;
                }
                
                const token = await getAuthToken();
                
                // Fetch detailed email information with error handling
                const emails = [];
                for (const message of emailsResponse.messages) {
                    try {
                        const email = await fetchEmailDetails(message.id, token);
                        emails.push(email);
                    } catch (error) {
                        console.warn(`Failed to fetch email ${message.id}:`, error.message);
                    }
                }
                
                if (emails.length === 0) {
                    console.warn(`No emails successfully fetched in run ${run}`);
                    continue;
                }
                
                        // Extract snippets and links from emails
        const emailsWithSnippets = [];
        for (const email of emails) {
            try {
                const [extractedSnippet, relevantLinks] = await Promise.all([
                    extractEmailSnippet(email.body),
                    extractRelevantLinks(email.body)
                ]);
                
                emailsWithSnippets.push({
                    ...email,
                    extractedSnippet,
                    relevantLinks
                });
            } catch (error) {
                console.warn(`Failed to extract snippet/links for email ${email.id}:`, error.message);
                emailsWithSnippets.push({
                    ...email,
                    extractedSnippet: '',
                    relevantLinks: []
                });
            }
        }
                
                // Apply AI filtering and capture decisions
                const { filteredEmails, decisions } = await filterEmailsWithDecisions(emailsWithSnippets, preferences);
                
                // Create individual email records for this run
                const runEmailRecords = emailsWithSnippets.map(email => {
                    const decision = decisions.find(d => d.id === email.id);
                    return {
                        emailTitle: `"${email.subject || 'No Subject'}" from ${email.from || 'Unknown Sender'}`,
                        rawContent: email.extractedSnippet || 'No content extracted',
                        aiDecision: decision ? decision.include : false,
                        reason: decision ? decision.reason : 'No decision found'
                    };
                });
                
                allRunResults.push({
                    run: run,
                    emailRecords: runEmailRecords
                });
                
                // Update page token for next run
                pageToken = emailsResponse.nextPageToken;
                
                // Add delay between runs to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`Error in test run ${run}:`, error);
                continue;
            }
        }
        
        return allRunResults;
        
    } catch (error) {
        console.error('Error in debug test:', error);
        throw error;
    } finally {
        await offscreenManager.close();
    }
}

/**
 * Convert test results to CSV format with multiple sheets
 * @param {Array} allRunResults Array of run results
 * @returns {string} CSV formatted string with multiple sheets
 */
function convertToCSV(allRunResults) {
    let csvContent = '';
    
    allRunResults.forEach((runResult, index) => {
        // Add sheet separator (except for first sheet)
        if (index > 0) {
            csvContent += '\n\n';
        }
        
        // Sheet header
        csvContent += `=== RUN ${runResult.run} ===\n`;
        
        // Column headers
        csvContent += 'Email Title and Sender,Raw Content,AI Decision,Reason\n';
        
        // Email rows
        runResult.emailRecords.forEach(record => {
            const escapedTitle = `"${record.emailTitle.replace(/"/g, '""')}"`;
            const escapedContent = `"${record.rawContent.replace(/"/g, '""')}"`;
            const decision = record.aiDecision ? 'TRUE' : 'FALSE';
            const escapedReason = `"${record.reason.replace(/"/g, '""')}"`;
            
            csvContent += `${escapedTitle},${escapedContent},${decision},${escapedReason}\n`;
        });
    });
    
    return csvContent;
}

/**
 * Save test results to CSV file
 * @param {Array} allRunResults Array of run results
 * @returns {Promise<void>}
 */
async function saveTestResultsToCSV(allRunResults) {
    const csvContent = convertToCSV(allRunResults);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `email_filter_testing_${timestamp}.csv`;
    
    // Store CSV content in Chrome storage and also log it for manual saving
    await chrome.storage.local.set({
        [`debug_test_${timestamp}`]: {
            filename: filename,
            content: csvContent,
            timestamp: new Date().toISOString()
        },
        'latest_debug_test': {
            filename: filename,
            content: csvContent,
            timestamp: new Date().toISOString()
        }
    });
    
    // Also log the CSV content to console for easy copying
    console.log('='.repeat(80));
    console.log(`DEBUG TEST RESULTS - ${filename}`);
    console.log('='.repeat(80));
    console.log(csvContent);
    console.log('='.repeat(80));
    console.log('CSV content has been logged above and saved to Chrome storage.');
    console.log('You can copy the content above and save it manually as a CSV file.');
    console.log('='.repeat(80));
    
    // Also create a downloadable blob URL
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    console.log('CSV Blob URL (copy this to download):', url);
    
    return { filename, content: csvContent, blobUrl: url };
}

/**
 * Get the latest debug test results from storage
 * @returns {Promise<Object>} Latest test results
 */
export async function getLatestDebugResults() {
    try {
        const result = await chrome.storage.local.get('latest_debug_test');
        return result.latest_debug_test || null;
    } catch (error) {
        console.error('Error retrieving debug results:', error);
        return null;
    }
}

/**
 * Get all debug test results from storage
 * @returns {Promise<Array>} All stored test results
 */
export async function getAllDebugResults() {
    try {
        const allData = await chrome.storage.local.get();
        const debugResults = [];
        
        for (const [key, value] of Object.entries(allData)) {
            if (key.startsWith('debug_test_') && key !== 'latest_debug_test') {
                debugResults.push({
                    key,
                    ...value
                });
            }
        }
        
        // Sort by timestamp (newest first)
        debugResults.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        return debugResults;
    } catch (error) {
        console.error('Error retrieving all debug results:', error);
        return [];
    }
}

/**
 * Generate CSV content for link filtering test results
 * @param {Array} testResults Array of test results from link filtering
 * @returns {string} CSV formatted string
 */
function generateLinkFilteringCSV(testResults) {
    let csvContent = '';
    
    // Header
    csvContent += 'Run,Email Subject,From,Total Links,Relevant Links,Filtering Rate,All Links (First 10),Relevant Links Kept\n';
    
    // Data rows
    testResults.forEach(result => {
        const run = result.run || 'N/A';
        const subject = `"${(result.subject || 'No Subject').replace(/"/g, '""')}"`;
        const from = `"${(result.from || 'Unknown').replace(/"/g, '""')}"`;
        const totalLinks = result.totalLinks || 0;
        const relevantLinks = result.filteredLinks || 0;
        const filteringRate = result.filteringRate || 0;
        
        // Format all links (first 10) with better readability - each link on a new line
        const allLinksText = result.allLinks ? 
            result.allLinks.slice(0, 10).map(link => `${link.text}\n→ ${link.href || link.url}`).join('\n\n') : 
            'No links found';
        const allLinksFormatted = `"${allLinksText.replace(/"/g, '""')}"`;
        
        // Format relevant links kept with better readability
        const relevantLinksText = result.relevantLinks && result.relevantLinks.length > 0 ? 
            result.relevantLinks.map(link => `${link.text}\n→ ${link.href || link.url}`).join('\n\n') : 
            'No relevant links';
        const relevantLinksFormatted = `"${relevantLinksText.replace(/"/g, '""')}"`;
        
        csvContent += `${run},${subject},${from},${totalLinks},${relevantLinks},${filteringRate}%,${allLinksFormatted},${relevantLinksFormatted}\n`;
    });
    
    return csvContent;
}

/**
 * Get the latest link filtering test results from storage
 * @returns {Promise<Object>} Latest link test results
 */
export async function getLatestLinkTestResults() {
    try {
        const result = await chrome.storage.local.get('latest_link_test');
        return result.latest_link_test || null;
    } catch (error) {
        console.error('Error retrieving link test results:', error);
        return null;
    }
}

/**
 * Test link filtering algorithm on real emails
 * @returns {Promise<Object>} Test results
 */
export async function runLinkFilteringTest() {
    console.log('🔗🔗🔗 STARTING LINK FILTERING TEST 🔗🔗🔗');
    console.log('Starting link filtering algorithm test on real emails...');
    
    try {
        await offscreenManager.setup();
        
        // Run 5 test cycles, fetching 5 emails each
        let allTestResults = [];
        let pageToken = null;
        let totalEmailsTested = 0;
        
        for (let run = 1; run <= 8; run++) {
            console.log(`[Link Test] Starting run ${run}/8...`);
            
            try {
                const emailsResponse = await fetchUpdatesEmails(5, pageToken);
                
                if (!emailsResponse.messages || emailsResponse.messages.length === 0) {
                    console.log(`[Link Test] No more emails available at run ${run}`);
                    break;
                }
                
                const token = await getAuthToken();
                const emails = [];
                
                // Fetch detailed email information
                for (const message of emailsResponse.messages) {
                    try {
                        const email = await fetchEmailDetails(message.id, token);
                        if (email) {
                            emails.push(email);
                        }
                    } catch (error) {
                        console.warn(`Failed to fetch email ${message.id}:`, error.message);
                    }
                }
                
                console.log(`[Link Test] Run ${run}: Testing link filtering on ${emails.length} emails...`);
                
                // Extract all links and test filtering for each email in this run
                const runResults = [];
                
                for (const email of emails) {
                    try {
                        // Extract all raw links first
                        const rawLinksResult = await chrome.runtime.sendMessage({
                            type: 'extract-links',
                            target: 'offscreen',
                            data: { htmlString: email.body },
                        });
                        
                        const allLinks = rawLinksResult?.links || [];
                        console.log(`[Service Worker] Email "${email.subject}" (ID: ${email.id}): extracted ${allLinks.length} raw links`);
                        
                        // Log some sample links for debugging
                        allLinks.slice(0, 3).forEach((link, i) => {
                            console.log(`[Service Worker] Sample link ${i + 1}: "${link.text}" → ${link.url?.substring(0, 80)}...`);
                        });
                        
                        // Apply filtering
                        const filteredLinks = filterRelevantLinks(allLinks);
                        console.log(`[Service Worker] Email ${email.id}: After filtering: ${filteredLinks.length} relevant links kept`);
                        
                        // Log duplicate Warp links specifically
                        const warpLinks = filteredLinks.filter(link => link.text.toLowerCase().includes('warp'));
                        if (warpLinks.length > 0) {
                            console.log(`[Service Worker] Email ${email.id}: Found ${warpLinks.length} Warp links:`);
                            warpLinks.forEach((link, i) => {
                                console.log(`[Service Worker]   Warp ${i + 1}: "${link.text}" → ${link.url}`);
                            });
                        }
                        
                        const emailResult = {
                            run: run,
                            emailId: email.id,
                            subject: email.subject || 'No Subject',
                            from: email.from || 'Unknown Sender',
                            totalLinks: allLinks.length,
                            filteredLinks: filteredLinks.length,
                            allLinks: allLinks.slice(0, 50), // Increased limit for display
                            relevantLinks: filteredLinks,
                            filteringRate: allLinks.length > 0 ? Math.round((allLinks.length - filteredLinks.length) / allLinks.length * 100) : 0
                        };
                        
                        runResults.push(emailResult);
                        
                        console.log(`[Link Test] Run ${run} - Email "${email.subject}": ${allLinks.length} total → ${filteredLinks.length} relevant (${emailResult.filteringRate}% filtered)`);
                        
                    } catch (error) {
                        console.error(`Error testing email ${email.id}:`, error);
                        runResults.push({
                            run: run,
                            emailId: email.id,
                            subject: email.subject || 'No Subject',
                            from: email.from || 'Unknown Sender',
                            error: error.message
                        });
                    }
                }
                
                allTestResults.push(...runResults);
                totalEmailsTested += emails.length;
                
                // Update page token for next run
                pageToken = emailsResponse.nextPageToken;
                
                // Add delay between runs to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`Error in link test run ${run}:`, error);
                continue;
            }
        }
        
        if (allTestResults.length === 0) {
            return {
                success: false,
                error: 'No emails were successfully processed'
            };
        }
        
        // Global deduplication across all emails in the test
        console.log(`[Global Dedup] Starting with ${allTestResults.length} email results`);
        const globalSeenKeys = new Set();
        const globallyDeduplicatedResults = [];
        
        // Helper function for global deduplication
        function globalNormalizeUrl(url) {
            try {
                const urlObj = new URL(url);
                // Remove ALL query parameters for better deduplication
                urlObj.search = '';
                urlObj.hash = '';
                return urlObj.toString();
            } catch (error) {
                console.log(`[Global Normalize] Failed to parse URL: ${error.message}`);
                return url;
            }
        }
        
        for (const emailResult of allTestResults) {
            if (emailResult.error) {
                globallyDeduplicatedResults.push(emailResult);
                continue;
            }
            
            const deduplicatedRelevantLinks = [];
            
            for (const link of emailResult.relevantLinks || []) {
                const originalUrl = link.url || link.href || '';
                const normalizedUrl = globalNormalizeUrl(originalUrl);
                const linkText = link.text.trim().toLowerCase();
                
                // Create unique key combining text and normalized URL
                // This catches both exact URL duplicates and same-text-same-domain duplicates
                const uniqueKey = `${linkText}|||${normalizedUrl}`;
                
                // Also create a text+domain key to catch sponsored content variations
                let domain = '';
                try {
                    domain = new URL(normalizedUrl).hostname;
                } catch (e) {
                    domain = normalizedUrl;
                }
                const textDomainKey = `${linkText}|||${domain}`;
                
                if (!globalSeenKeys.has(uniqueKey) && !globalSeenKeys.has(textDomainKey)) {
                    globalSeenKeys.add(uniqueKey);
                    globalSeenKeys.add(textDomainKey);
                    deduplicatedRelevantLinks.push(link);
                } else {
                    console.log(`[Global Dedup] Skipped duplicate: "${link.text.substring(0, 50)}..." → ${normalizedUrl}`);
                }
            }
            
            // Update the email result with globally deduplicated links
            emailResult.relevantLinks = deduplicatedRelevantLinks;
            emailResult.filteredLinks = deduplicatedRelevantLinks.length;
            globallyDeduplicatedResults.push(emailResult);
        }
        
        console.log(`[Global Dedup] Completed global deduplication`);
        allTestResults = globallyDeduplicatedResults;
        
        // Save results to storage
        const timestamp = new Date().toISOString();
        const resultsData = {
            timestamp,
            testType: 'link_filtering',
            emailsTested: totalEmailsTested,
            runs: 8,
            results: allTestResults,
            summary: {
                totalEmails: allTestResults.length,
                totalLinksFound: allTestResults.reduce((sum, r) => sum + (r.totalLinks || 0), 0),
                totalLinksKept: allTestResults.reduce((sum, r) => sum + (r.filteredLinks || 0), 0),
                averageFilteringRate: Math.round(allTestResults.reduce((sum, r) => sum + (r.filteringRate || 0), 0) / allTestResults.length)
            }
        };
        
        // Generate CSV content with improved formatting
        const csvContent = generateLinkFilteringCSV(allTestResults);
        const csvFilename = `link_filtering_test_${timestamp.replace(/[:.]/g, '-')}.csv`;
        
        // Store in Chrome storage with CSV
        const storageData = {
            ...resultsData,
            csvContent,
            csvFilename
        };
        
        // Clear old test results to free up storage space
        const existingKeys = await chrome.storage.local.get();
        const oldTestKeys = Object.keys(existingKeys).filter(key => key.startsWith('link_test_') && key !== `link_test_${timestamp}`);
        if (oldTestKeys.length > 0) {
            console.log(`[Storage] Clearing ${oldTestKeys.length} old test results to free space`);
            await chrome.storage.local.remove(oldTestKeys);
        }
        
        // Store only essential data to avoid quota issues
        const essentialData = {
            ...resultsData,
            csvContent,
            csvFilename,
            // Limit stored results to reduce storage usage
            results: allTestResults.map(result => ({
                ...result,
                allLinks: result.allLinks?.slice(0, 10) || [], // Limit stored links
                relevantLinks: result.relevantLinks?.slice(0, 20) || [] // Keep more relevant links
            }))
        };
        
        await chrome.storage.local.set({
            'latest_link_test': essentialData
        });
        
        console.log('Link filtering test completed and saved to storage');
        console.log('='.repeat(80));
        console.log(`LINK FILTERING CSV - ${csvFilename}`);
        console.log('='.repeat(80));
        console.log(csvContent);
        console.log('='.repeat(80));
        
        return {
            success: true,
            results: storageData,
            message: `Tested ${totalEmailsTested} emails across 8 runs, found ${resultsData.summary.totalLinksFound} links, kept ${resultsData.summary.totalLinksKept} relevant ones`
        };
        
    } catch (error) {
        console.error('Link filtering test failed:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        await offscreenManager.close();
    }
}

/**
 * Main function to run the debug test and save results
 * @returns {Promise<Object>} Test results and CSV info
 */
export async function runDebugTestAndSave() {
    try {
        console.log('Starting email filter debug test...');
        const allRunResults = await runEmailFilterDebugTest();
        
        console.log('Test completed. Saving results to CSV...');
        const csvInfo = await saveTestResultsToCSV(allRunResults);
        
        console.log('Debug test completed successfully!');
        return { testResults: allRunResults, csvInfo };
    } catch (error) {
        console.error('Debug test failed:', error);
        throw error;
    }
} 