import { getInsightsReport, getKnowledgeWebStats } from '../lib/knowledge-web.js';

// DOM Elements
const totalDigestsEl = document.getElementById('totalDigests');
const totalTrendsEl = document.getElementById('totalTrends');
const totalOpportunitiesEl = document.getElementById('totalOpportunities');
const lastUpdatedEl = document.getElementById('lastUpdated');
const executiveSummaryEl = document.getElementById('executiveSummary');
const trendsContainerEl = document.getElementById('trendsContainer');
const opportunitiesContainerEl = document.getElementById('opportunitiesContainer');
const recommendationsContainerEl = document.getElementById('recommendationsContainer');
const timelineContainerEl = document.getElementById('timelineContainer');
const networkContainerEl = document.getElementById('networkContainer');
const refreshBtn = document.getElementById('refreshBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');

// Load insights on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadInsights();
});

// Event listeners
refreshBtn.addEventListener('click', async () => {
    await loadInsights();
});

exportBtn.addEventListener('click', exportReport);

clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all knowledge web data? This action cannot be undone.')) {
        // TODO: Implement clear functionality
        alert('Clear functionality will be implemented in the next iteration.');
    }
});

/**
 * Load and display all insights
 */
async function loadInsights() {
    try {
        showLoading();
        
        // Load statistics
        const stats = await getKnowledgeWebStats();
        updateStats(stats);
        
        // Load insights report
        const report = await getInsightsReport();
        displayInsights(report);
        
    } catch (error) {
        console.error('Error loading insights:', error);
        showError('Failed to load insights. Please try again.');
    }
}

/**
 * Update statistics display
 */
function updateStats(stats) {
    totalDigestsEl.textContent = stats.totalDigests;
    totalTrendsEl.textContent = stats.totalTrends;
    totalOpportunitiesEl.textContent = stats.totalOpportunities;
    
    if (stats.lastAnalysis) {
        const date = new Date(stats.lastAnalysis);
        lastUpdatedEl.textContent = date.toLocaleDateString();
    } else {
        lastUpdatedEl.textContent = 'Never';
    }
}

/**
 * Display insights report
 */
function displayInsights(report) {
    displayExecutiveSummary(report.summary);
    displayTrends(report.trends);
    displayOpportunities(report.opportunities);
    displayRecommendations(report.recommendations);
    displayTimeline(report.timeline);
    displayNetwork(report);
}

/**
 * Display executive summary
 */
function displayExecutiveSummary(summary) {
    if (summary) {
        executiveSummaryEl.innerHTML = `
            <div class="summary-content">
                <p>${summary}</p>
            </div>
        `;
    } else {
        executiveSummaryEl.innerHTML = `
            <div class="empty-state">
                <p>No summary available yet. Generate your first digest to start building insights.</p>
            </div>
        `;
    }
}

/**
 * Display trends
 */
function displayTrends(trends) {
    if (trends && trends.length > 0) {
        const trendsHTML = trends.map(trend => `
            <div class="trend-card">
                <div class="trend-header">
                    <h3>${trend.title || 'Unnamed Trend'}</h3>
                    <span class="trend-confidence">${Math.round(trend.confidence * 100)}% confidence</span>
                </div>
                <p class="trend-description">${trend.description || 'No description available'}</p>
                <div class="trend-metrics">
                    <span class="metric">Frequency: ${trend.frequency || 'Unknown'}</span>
                    <span class="metric">Growth: ${trend.growth || 'Unknown'}</span>
                </div>
            </div>
        `).join('');
        
        trendsContainerEl.innerHTML = trendsHTML;
    } else {
        trendsContainerEl.innerHTML = `
            <div class="empty-state">
                <p>No trends identified yet. Continue reading digests to build trend analysis.</p>
            </div>
        `;
    }
}

/**
 * Display opportunities
 */
function displayOpportunities(opportunities) {
    if (opportunities && opportunities.length > 0) {
        const opportunitiesHTML = opportunities.map(opp => `
            <div class="opportunity-card">
                <div class="opportunity-header">
                    <h3>${opp.title || 'Unnamed Opportunity'}</h3>
                    <span class="opportunity-type">${opp.type || 'General'}</span>
                </div>
                <p class="opportunity-description">${opp.description || 'No description available'}</p>
                <div class="opportunity-details">
                    <span class="detail">Market Size: ${opp.marketSize || 'Unknown'}</span>
                    <span class="detail">Timeline: ${opp.timeline || 'Unknown'}</span>
                </div>
                <div class="opportunity-actions">
                    <button class="action-btn">Learn More</button>
                    <button class="action-btn">Track</button>
                </div>
            </div>
        `).join('');
        
        opportunitiesContainerEl.innerHTML = opportunitiesHTML;
    } else {
        opportunitiesContainerEl.innerHTML = `
            <div class="empty-state">
                <p>No opportunities identified yet. Continue reading digests to discover opportunities.</p>
            </div>
        `;
    }
}

/**
 * Display recommendations
 */
function displayRecommendations(recommendations) {
    if (recommendations && recommendations.length > 0) {
        const recommendationsHTML = recommendations.map(rec => `
            <div class="recommendation-item">
                <div class="recommendation-icon">💡</div>
                <div class="recommendation-content">
                    <h4>${rec.title || 'Recommendation'}</h4>
                    <p>${rec.description || 'No description available'}</p>
                    <div class="recommendation-meta">
                        <span class="priority">Priority: ${rec.priority || 'Medium'}</span>
                        <span class="category">${rec.category || 'General'}</span>
                    </div>
                </div>
            </div>
        `).join('');
        
        recommendationsContainerEl.innerHTML = recommendationsHTML;
    } else {
        recommendationsContainerEl.innerHTML = `
            <div class="empty-state">
                <p>No recommendations available yet. Generate more digests to receive personalized recommendations.</p>
            </div>
        `;
    }
}

/**
 * Display timeline
 */
function displayTimeline(timeline) {
    if (timeline && timeline.length > 0) {
        const timelineHTML = timeline.map(event => `
            <div class="timeline-item">
                <div class="timeline-date">${event.date}</div>
                <div class="timeline-content">
                    <h4>${event.title || 'Event'}</h4>
                    <p>${event.description || 'No description available'}</p>
                    <span class="timeline-category">${event.category || 'General'}</span>
                </div>
            </div>
        `).join('');
        
        timelineContainerEl.innerHTML = `
            <div class="timeline">
                ${timelineHTML}
            </div>
        `;
    } else {
        timelineContainerEl.innerHTML = `
            <div class="empty-state">
                <p>No timeline events available yet. Continue reading digests to build a timeline.</p>
            </div>
        `;
    }
}

/**
 * Display topic network
 */
function displayNetwork(report) {
    // TODO: Implement network visualization
    // This could use a library like D3.js or vis.js
    networkContainerEl.innerHTML = `
        <div class="network-placeholder">
            <p>Topic network visualization will be implemented in the next iteration.</p>
            <p>This will show connections between different topics and entities over time.</p>
        </div>
    `;
}

/**
 * Show loading state
 */
function showLoading() {
    // Add loading indicators to all containers
    const containers = [
        executiveSummaryEl, trendsContainerEl, opportunitiesContainerEl,
        recommendationsContainerEl, timelineContainerEl, networkContainerEl
    ];
    
    containers.forEach(container => {
        if (container.innerHTML.includes('loading')) return;
        container.innerHTML = '<div class="loading">Loading...</div>';
    });
}

/**
 * Show error message
 */
function showError(message) {
    // TODO: Implement proper error display
    alert(message);
}

/**
 * Export insights report
 */
async function exportReport() {
    try {
        const report = await getInsightsReport();
        const stats = await getKnowledgeWebStats();
        
        const exportData = {
            generatedAt: new Date().toISOString(),
            statistics: stats,
            insights: report
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `knowledge-web-insights-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
    } catch (error) {
        console.error('Error exporting report:', error);
        alert('Failed to export report. Please try again.');
    }
} 