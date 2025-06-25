/**
 * Gmail API integration for fetching and processing newsletter emails
 */

const GMAIL_API_SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify'
];

const NEWSLETTER_QUERY = 'category:promotions OR category:updates';

/**
 * Initialize Gmail API authentication
 * @returns {Promise<boolean>} Whether authentication was successful
 */
export async function initializeGmailAPI() {
    try {
        const token = await chrome.identity.getAuthToken({ interactive: true });
        if (!token) {
            throw new Error('Failed to get auth token');
        }
        return true;
    } catch (error) {
        console.error('Gmail API initialization error:', error);
        throw new Error('Failed to authenticate with Gmail');
    }
}

/**
 * Fetch newsletter emails from Gmail
 * @param {Object} options Query options
 * @returns {Promise<Array>} Array of processed email objects
 */
export async function fetchNewsletterEmails(period = '7d') {
    try {
        const token = await getAuthToken();
        const query = `category:updates AND "unsubscribe" newer_than:${period}`;

        const response = await fetch(`https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });

        if (!response.ok) {
            throw new Error(`Gmail API error: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Gracefully handle cases where no emails match the query
        if (!data.messages || data.messages.length === 0) {
            console.log("No newsletter emails found.");
            return [];
        }

        const emails = await Promise.all(
            data.messages.slice(0, 50).map(message => 
                fetchEmailDetails(message.id, token)
            )
        );

        return emails;
    } catch (error) {
        console.error('Error fetching emails:', error);
        throw new Error('Failed to fetch emails');
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
            `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
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
    const date = headers.find(h => h.name === 'Date')?.value || '';
    const listUnsubscribe = headers.find(h => h.name === 'List-Unsubscribe')?.value || null;

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
        date: new Date(date),
        listUnsubscribe,
        body,
        snippet: emailData.snippet
    };
}

/**
 * Mark an email as read
 * @param {string} messageId Gmail message ID
 * @returns {Promise<void>}
 */
export async function markAsRead(messageId) {
    try {
        const token = await chrome.identity.getAuthToken({ interactive: false });
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch(
            `https://www.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    removeLabelIds: ['UNREAD']
                })
            }
        );

        if (!response.ok) {
            throw new Error(`Failed to mark email as read: ${response.statusText}`);
        }
    } catch (error) {
        console.error('Error marking email as read:', error);
        throw error;
    }
}

/**
 * Gmail API helper functions
 */

const GMAIL_API_ROOT = 'https://www.googleapis.com/gmail/v1/users/';

/**
 * Gets a Google Auth token for the user.
 * @returns {Promise<string>} The auth token.
 */
function getAuthToken() {
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
 * Fetches the most recent email from the user's inbox.
 * @returns {Promise<Object>} The latest email object with id, subject, from, and content.
 */
export async function fetchLatestEmail() {
    const token = await getAuthToken();
    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };

    // 1. Get the ID of the most recent message
    const listResponse = await fetch(`${GMAIL_API_ROOT}me/messages?maxResults=1`, { headers });
    if (!listResponse.ok) {
        throw new Error(`Gmail API error (list): ${listResponse.status}`);
    }
    const listData = await listResponse.json();
    if (!listData.messages || listData.messages.length === 0) {
        throw new Error("No emails found in the inbox.");
    }
    const latestMessageId = listData.messages[0].id;

    // 2. Fetch the full message content using the ID
    const messageResponse = await fetch(`${GMAIL_API_ROOT}me/messages/${latestMessageId}?format=full`, { headers });
    if (!messageResponse.ok) {
        throw new Error(`Gmail API error (get): ${messageResponse.status}`);
    }
    const message = await messageResponse.json();

    // 3. Process the raw email data using the standard helper to ensure consistency
    return processEmailData(message);
}

/**
 * Parses the email payload to find the plain text or HTML content.
 * @param {Object} payload - The email message payload from the Gmail API.
 * @returns {string} The decoded email body content.
 */
function parseEmailContent(payload) {
    let content = '';

    if (payload.body && payload.body.data) {
        content = atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    }

    if (!content && payload.parts) {
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart && textPart.body.data) {
            content = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        } else {
            // Fallback to HTML if plain text is not available
            const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
            if (htmlPart && htmlPart.body.data) {
                const htmlContent = atob(htmlPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                // Basic HTML to text conversion
                const doc = new DOMParser().parseFromString(htmlContent, 'text/html');
                content = doc.body.textContent || "";
            }
        }
    }
    
    return content;
} 