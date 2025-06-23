import { generateDigest } from '../lib/digest-generator.js';

// Listen for messages from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Route message to the appropriate handler
    if (request.type === 'GENERATE_DIGEST') {
        console.log('Received GENERATE_DIGEST message');
        
        // Pass the period from the request to the generator
        const period = request.period || '7d'; // Default to 7d if not provided

        generateDigest(period)
            .then(result => {
                console.log('Digest generation result:', result);
                sendResponse(result);
            })
            .catch(error => {
                console.error('Background script error:', error);
                sendResponse({ success: false, error: error.message });
            });
            
        return true; // Indicates that the response is sent asynchronously
    }
    
    // The 'FETCH_URL_CONTENT' handler is removed to prevent deadlock.
});

// Optional: Add listeners for scheduled tasks or other background events here. 