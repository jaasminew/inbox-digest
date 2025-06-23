import { formatDate, formatDuration } from '../lib/utils.js';
import { exportDigest } from '../lib/digest-generator.js';

// DOM Elements
const digestTitle = document.getElementById('digestTitle');
const digestDate = document.getElementById('digestDate');
const readingTime = document.getElementById('readingTime');
const digestContent = document.getElementById('digestContent');
const totalItems = document.getElementById('totalItems');
const topSource = document.getElementById('topSource');
const avgScore = document.getElementById('avgScore');
const exportBtn = document.getElementById('exportBtn');
const printBtn = document.getElementById('printBtn');
const exportMenu = document.getElementById('exportMenu');

// Load digest data
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const digestId = new URLSearchParams(window.location.search).get('id');
        if (!digestId) {
            throw new Error('No digest ID provided');
        }

        const { digests = [] } = await chrome.storage.sync.get('digests');
        const digest = digests.find(d => d.id === digestId);
        
        if (!digest) {
            throw new Error('Digest not found');
        }

        renderDigest(digest);
    } catch (error) {
        console.error('Error loading digest:', error);
        showError('Failed to load digest');
    }
});

// Handle export button click
exportBtn.addEventListener('click', () => {
    exportMenu.classList.toggle('hidden');
});

// Handle export menu clicks
exportMenu.addEventListener('click', async (e) => {
    const button = e.target.closest('button');
    if (!button) return;

    const format = button.dataset.format;
    const digestId = new URLSearchParams(window.location.search).get('id');
    
    try {
        const { digests = [] } = await chrome.storage.sync.get('digests');
        const digest = digests.find(d => d.id === digestId);
        
        if (!digest) {
            throw new Error('Digest not found');
        }

        const content = exportDigest(digest, format);
        const filename = `inbox-digest-${digest.id}.${format}`;
        
        downloadFile(content, filename, getMimeType(format));
        exportMenu.classList.add('hidden');
    } catch (error) {
        console.error('Error exporting digest:', error);
        showError('Failed to export digest');
    }
});

// Handle print button click
printBtn.addEventListener('click', () => {
    window.print();
});

// Close export menu when clicking outside
document.addEventListener('click', (e) => {
    if (!exportBtn.contains(e.target) && !exportMenu.contains(e.target)) {
        exportMenu.classList.add('hidden');
    }
});

// Helper Functions
function renderDigest(digest) {
    // Set title and metadata
    digestTitle.textContent = digest.title;
    digestDate.textContent = formatDate(new Date(digest.date), 'long');
    readingTime.textContent = `${digest.stats.readingTime} min read`;
    
    // Render content sections
    digestContent.innerHTML = digest.sections.map(section => `
        <div class="section">
            <h2 class="section-title">${section.title}</h2>
            ${section.items.map(item => `
                <div class="item">
                    <h3 class="item-title">${item.title}</h3>
                    <div class="item-meta">
                        <span>${item.source}</span>
                        <span>${formatDate(new Date(item.date), 'short')}</span>
                    </div>
                    <div class="item-summary">${item.summary}</div>
                </div>
            `).join('')}
        </div>
    `).join('');
    
    // Update stats
    totalItems.textContent = digest.stats.totalItems;
    topSource.textContent = digest.stats.topSources[0]?.source || '-';
    avgScore.textContent = (digest.stats.averageScore * 100).toFixed(0) + '%';
}

function getMimeType(format) {
    switch (format) {
        case 'html':
            return 'text/html';
        case 'markdown':
            return 'text/markdown';
        case 'text':
            return 'text/plain';
        default:
            return 'text/plain';
    }
}

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showError(message) {
    // TODO: Implement proper error notification
    alert(message);
} 