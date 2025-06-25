import { marked } from 'https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js';

// DOM Elements
const digestContent = document.getElementById('digestContent');
const printBtn = document.getElementById('printBtn');

console.log('[Digest] Script loaded, waiting for digest content...');

// Listen for the digest content sent from the background script or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Digest] Received message:', request);
    
    if (request.type === 'LOAD_DIGEST') {
        const { digest } = request;
        console.log('[Digest] Received digest content:', digest ? digest.substring(0, 200) + '...' : 'null/undefined');
        
        if (digest) {
            renderDigest(digest);
        } else {
            showError('Received empty digest content.');
        }
    }
});

function renderDigest(digestMarkdown) {
    console.log('[Digest] Rendering digest, markdown length:', digestMarkdown.length);
    
    try {
        // Convert the Markdown content to HTML
        const digestHtml = marked.parse(digestMarkdown);
        console.log('[Digest] Converted to HTML, length:', digestHtml.length);
        digestContent.innerHTML = digestHtml;
        console.log('[Digest] Successfully rendered digest');
    } catch (error) {
        console.error('Error parsing Markdown:', error);
        showError('Could not display the digest due to a formatting error.');
    }
}

// Handle print button click
printBtn.addEventListener('click', () => {
    window.print();
});

function showError(message) {
    console.log('[Digest] Showing error:', message);
    digestContent.innerHTML = `<div class="error-message">${message}</div>`;
} 