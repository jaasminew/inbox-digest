// Readability library is now loaded via HTML script tag
console.log('[Offscreen] Script starting...');

// This script runs in the offscreen document.
chrome.runtime.onMessage.addListener(handleMessages);
console.log('[Offscreen] Message listener registered.');

function handleMessages(message, sender, sendResponse) {
    console.log('[Offscreen] Received message:', message.type);
    
    if (message.target !== 'offscreen') {
        return;
    }

    switch (message.type) {
        case 'ping':
            console.log('[Offscreen] Responding to ping with pong');
            sendResponse({ pong: true });
            break;
        case 'clean-html':
            const { htmlString } = message.data;
            const cleanedContent = cleanEmailContent(htmlString);
            sendResponse(cleanedContent);
            break;
        case 'extract-links':
            const { htmlString: linkHtml } = message.data;
            const extractedLinks = extractLinksFromHtml(linkHtml);
            sendResponse({ links: extractedLinks });
            break;
        default:
            console.warn(`Unexpected message type received: '${message.type}'.`);
    }
    // Return true to indicate you wish to send a response asynchronously
    return true;
}

/**
 * Extract links from HTML with their anchor text, handling complex newsletter structures
 * @param {string} htmlString The raw HTML of the email
 * @returns {Array<Object>} Array of {text, href, url} objects
 */
function extractLinksFromHtml(htmlString) {
    if (!htmlString) return [];
    
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');
        
        const links = [];
        const anchorElements = doc.querySelectorAll('a[href]');
        
        anchorElements.forEach(anchor => {
            const href = anchor.getAttribute('href');
            
            // Skip invalid links
            if (!href || 
                href.startsWith('javascript:') || 
                href.startsWith('mailto:') ||
                href.startsWith('#')) {
                return;
            }
            
            // Strategy 1: Get text directly from anchor
            let text = anchor.textContent.trim();
            
            // Strategy 2: For complex newsletter structures, look for meaningful text in nearby elements
            if (!text || text.length < 5 || href.includes(text) || text.match(/^https?:\/\//)) {
                // Look for text in parent container or siblings
                const parent = anchor.parentElement;
                if (parent) {
                    // Check siblings for meaningful text (common in newsletter layouts)
                    const siblings = Array.from(parent.children);
                    for (const sibling of siblings) {
                        if (sibling !== anchor) {
                            const siblingText = sibling.textContent.trim();
                            if (siblingText && siblingText.length > 10 && !siblingText.match(/^https?:\/\//)) {
                                text = siblingText;
                                break;
                            }
                        }
                    }
                    
                    // If still no good text, try parent's text content excluding the anchor
                    if (!text || text.length < 5) {
                        const parentText = parent.textContent.trim();
                        const anchorText = anchor.textContent.trim();
                        const cleanParentText = parentText.replace(anchorText, '').trim();
                        if (cleanParentText && cleanParentText.length > 10) {
                            text = cleanParentText;
                        }
                    }
                }
            }
            
            // Strategy 3: Look for strong/em/h1-h6 elements within or near the anchor
            if (!text || text.length < 5) {
                const emphasisElements = anchor.querySelectorAll('strong, em, b, i, h1, h2, h3, h4, h5, h6');
                for (const elem of emphasisElements) {
                    const emphasisText = elem.textContent.trim();
                    if (emphasisText && emphasisText.length > 10) {
                        text = emphasisText;
                        break;
                    }
                }
            }
            
            // Strategy 4: For tracking URLs, look in the surrounding table cell or container
            if (!text || text.length < 5 || href.includes('tracking')) {
                let container = anchor.closest('td, div, section, article');
                if (container) {
                    // Look for the first substantial text in the container
                    const walker = document.createTreeWalker(
                        container,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                const text = node.textContent.trim();
                                return text.length > 15 && !text.match(/^https?:\/\//) ? 
                                    NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                            }
                        }
                    );
                    
                    const textNode = walker.nextNode();
                    if (textNode) {
                        text = textNode.textContent.trim();
                    }
                }
            }
            
            // Final validation
            if (!text || text.length < 3) {
                return;
            }
            
            // Clean up text
            text = text.replace(/\s+/g, ' ').trim();
            
            // Skip if text is just the URL
            if (text === href || href.includes(text)) {
                return;
            }
            
            // Convert relative URLs to absolute if possible
            let url = href;
            if (href.startsWith('/') || href.startsWith('./')) {
                // Try to extract domain from other absolute URLs in the email
                const absoluteLinks = Array.from(doc.querySelectorAll('a[href^="http"]'));
                if (absoluteLinks.length > 0) {
                    try {
                        const sampleUrl = new URL(absoluteLinks[0].href);
                        url = new URL(href, sampleUrl.origin).toString();
                    } catch (e) {
                        // If URL construction fails, keep original
                    }
                }
            }
            
            links.push({ text, href, url });
        });
        
        // Remove duplicates based on URL and text combination
        const uniqueLinks = [];
        const seenCombos = new Set();
        
        links.forEach(link => {
            const combo = `${link.url}|||${link.text.toLowerCase()}`;
            if (!seenCombos.has(combo)) {
                seenCombos.add(combo);
                uniqueLinks.push(link);
            }
        });
        
        console.log(`[Offscreen] Extracted ${uniqueLinks.length} unique links from HTML (from ${anchorElements.length} anchor elements)`);
        return uniqueLinks;
        
    } catch (error) {
        console.error('[Offscreen] Error extracting links:', error);
        return [];
    }
}

/**
 * Extracts the core readable content from an email's HTML string using multiple strategies.
 * This handles complex newsletter layouts that often confuse simple parsers.
 * @param {string} htmlString The raw HTML of the email.
 * @returns {{text: string, links: Array<string>}} The cleaned text content and an array of unique links.
 */
function cleanEmailContent(htmlString) {
    if (!htmlString) return { text: '', links: [] };

    console.log('[Offscreen] Processing email HTML, length:', htmlString.length);

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlString, 'text/html');

        // Remove unwanted elements completely - enhanced for newsletters
        const unwantedSelectors = [
            'style', 'script', 'noscript', 'meta', 'link',
            '.header', '.footer', '.nav', '.navigation', 
            '.social', '.share', '.unsubscribe', '.preferences',
            '[style*="display:none"]', '[style*="visibility:hidden"]',
            '.preheader', '.email-header', '.email-footer',
            // McKinsey/newsletter specific
            '.footer-content', '.email-footer-content', '.unsubscribe-section',
            '.copyright', '.legal', '.disclaimer', '.address',
            '[class*="footer"]', '[id*="footer"]', '[class*="unsubscribe"]',
            // Common newsletter footer patterns
            'table[class*="footer"]', 'td[class*="footer"]', 'div[class*="footer"]',
            // Social media and sharing
            '.social-links', '.share-buttons', '[class*="social"]'
        ];
        
        unwantedSelectors.forEach(selector => {
            doc.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Strategy 1: Try Readability.js first (but with cleaned doc)
        let cleanedText = '';
        let readabilityWorked = false;
        
        try {
            // For McKinsey emails, try to find main content areas first
            if (htmlString.toLowerCase().includes('mckinsey')) {
                console.log('[Offscreen] Attempting McKinsey-specific extraction...');
                
                // Look for main content containers
                const mainContentSelectors = [
                    '[role="main"]',
                    '.main-content',
                    '.email-content',
                    '.newsletter-content',
                    'table[width="600"]', // Common newsletter width
                    'td[style*="padding"]',
                    '.content-wrapper'
                ];
                
                for (const selector of mainContentSelectors) {
                    const mainElement = doc.querySelector(selector);
                    if (mainElement) {
                        console.log(`[Offscreen] Found McKinsey content with selector: ${selector}`);
                        const testReader = new Readability(mainElement.cloneNode(true));
                        const testArticle = testReader.parse();
                        if (testArticle && testArticle.textContent && testArticle.textContent.trim().length > 200) {
                            cleanedText = testArticle.textContent;
                            readabilityWorked = true;
                            console.log('[Offscreen] McKinsey-specific extraction succeeded, extracted', cleanedText.length, 'characters');
                            break;
                        }
                    }
                }
            }
            
            // Fallback to regular Readability
            if (!readabilityWorked) {
                const reader = new Readability(doc.cloneNode(true));
                const article = reader.parse();
                
                if (article && article.textContent && article.textContent.trim().length > 100) {
                    cleanedText = article.textContent;
                    readabilityWorked = true;
                    console.log('[Offscreen] Regular Readability.js succeeded, extracted', cleanedText.length, 'characters');
                }
            }
        } catch (readabilityError) {
            console.log('[Offscreen] Readability.js failed:', readabilityError.message);
        }

        // Strategy 2: Newsletter-specific extraction for table-based layouts
        if (!readabilityWorked) {
            console.log('[Offscreen] Falling back to newsletter-specific extraction');
            
            // Look for content in table structures (common in newsletters)
            const contentCandidates = [];
            
            // Find all table cells and divs with substantial text content
            const allElements = doc.querySelectorAll('td, div, p, article, section');
            
            allElements.forEach((element, index) => {
                const text = element.textContent.trim();
                
                // Skip if too short or likely navigation/promotional
                if (text.length < 50) return;
                
                // Skip if it looks like navigation/header/footer content - enhanced
                const lowerText = text.toLowerCase();
                const skipPatterns = [
                    'share this email',
                    'view in browser',
                    'unsubscribe',
                    'sign up',
                    'advertise',
                    'view online',
                    'follow us',
                    'social media',
                    'contact us',
                    'privacy policy',
                    'terms of service',
                    'brought to you by',
                    'sponsored by',
                    'newsletter ads',
                    // McKinsey/professional newsletter patterns
                    'mckinsey & company',
                    'copyright ©',
                    'all rights reserved',
                    'world trade center',
                    'greenwich street',
                    'new york, ny',
                    'you received this email because',
                    'to unsubscribe',
                    'manage your preferences',
                    'forward this email',
                    'add us to your address book',
                    'email preferences',
                    'subscription center',
                    // Common footer phrases
                    'this email was sent to',
                    'if you no longer wish to receive',
                    'update your email preferences',
                    'legal disclaimer',
                    'confidential and proprietary'
                ];
                
                if (skipPatterns.some(pattern => lowerText.includes(pattern))) {
                    return;
                }
                
                // Skip if it's mostly links or short phrases
                const linkText = Array.from(element.querySelectorAll('a')).map(a => a.textContent).join(' ');
                if (linkText.length > text.length * 0.7) return; // More than 70% links
                
                // Calculate content quality score with newsletter-aware scoring
                const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
                const words = text.split(/\s+/).filter(w => w.length > 2);
                const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
                
                // Base quality score
                let qualityScore = sentences.length * 2 + words.length + avgWordLength;
                
                // Boost score for main content indicators
                const mainContentIndicators = [
                    'welcome to', 'in this edition', 'key insights', 'highlights',
                    'our research', 'new analysis', 'latest findings', 'report',
                    'study shows', 'according to', 'data reveals', 'survey',
                    'article', 'analysis', 'perspective', 'insights'
                ];
                
                const hasMainContentIndicators = mainContentIndicators.some(indicator => 
                    lowerText.includes(indicator)
                );
                
                if (hasMainContentIndicators) {
                    qualityScore *= 2; // Double the score for likely main content
                }
                
                // Penalize footer-like content more heavily
                const footerPenalty = skipPatterns.filter(pattern => lowerText.includes(pattern)).length;
                qualityScore -= footerPenalty * 50;
                
                // Position bonus - heavily favor earlier content, but not at the expense of quality
                const positionBonus = Math.max(0, 500 - index); // Reduced position bonus
                
                const finalScore = Math.max(0, qualityScore + positionBonus);
                
                contentCandidates.push({
                    element,
                    text,
                    score: finalScore,
                    qualityScore,
                    positionBonus,
                    wordCount: words.length,
                    sentenceCount: sentences.length,
                    documentOrder: index
                });
            });
            
            // Sort by final score (quality + position), but maintain some document order
            contentCandidates.sort((a, b) => {
                // If scores are close, prefer document order
                if (Math.abs(b.score - a.score) < 100) {
                    return a.documentOrder - b.documentOrder;
                }
                return b.score - a.score;
            });
            
            console.log('[Offscreen] Found', contentCandidates.length, 'content candidates');
            if (contentCandidates.length > 0) {
                console.log('[Offscreen] Top 3 candidates:');
                contentCandidates.slice(0, 3).forEach((c, i) => {
                    console.log(`  ${i+1}. Score: ${c.score} (quality: ${c.qualityScore}, position: ${c.positionBonus}), Order: ${c.documentOrder}, Text: "${c.text.substring(0, 100)}..."`);
                });
            }
            
            // Take the top candidates, but ensure we get content from the beginning
            const selectedContent = [];
            let totalWords = 0;
            
            // First pass: prioritize very early, high-quality content
            for (const candidate of contentCandidates) {
                if (candidate.documentOrder < 50 && candidate.qualityScore > 100) {
                    const isDuplicate = selectedContent.some(selected => 
                        selected.text.includes(candidate.text) || 
                        candidate.text.includes(selected.text)
                    );
                    
                    if (!isDuplicate && totalWords < 800) {
                        selectedContent.push(candidate);
                        totalWords += candidate.wordCount;
                    }
                }
                
                if (selectedContent.length >= 3 || totalWords >= 600) break;
            }
            
            // Second pass: fill in with other good content if needed
            if (selectedContent.length < 3 && totalWords < 400) {
                for (const candidate of contentCandidates) {
                    const isDuplicate = selectedContent.some(selected => 
                        selected.text.includes(candidate.text) || 
                        candidate.text.includes(selected.text)
                    );
                    
                    if (!isDuplicate && totalWords < 1000) {
                        selectedContent.push(candidate);
                        totalWords += candidate.wordCount;
                    }
                    
                    if (selectedContent.length >= 5 || totalWords >= 800) break;
                }
            }
            
            // Sort selected content by document order to maintain flow
            selectedContent.sort((a, b) => a.documentOrder - b.documentOrder);
            
            cleanedText = selectedContent.map(c => c.text).join('\n\n');
            console.log('[Offscreen] Newsletter extraction got', cleanedText.length, 'characters from', selectedContent.length, 'sections');
            console.log('[Offscreen] Selected sections in order:', selectedContent.map(c => `[${c.documentOrder}]`).join(', '));
        }

        // Strategy 3: Final fallback - aggressive text extraction
        if (!cleanedText || cleanedText.length < 50) {
            console.log('[Offscreen] Using final fallback - aggressive text extraction');
            
            // Get all text content but filter aggressively
            const allText = doc.body ? doc.body.textContent : doc.textContent;
            const paragraphs = allText.split(/\n\n+/).filter(p => {
                const trimmed = p.trim();
                if (trimmed.length < 30) return false;
                
                const lower = trimmed.toLowerCase();
                const skipPatterns = [
                    'share this email', 'view in browser', 'unsubscribe', 'sign up',
                    'advertise', 'view online', 'follow us', 'contact us', 'privacy policy'
                ];
                
                return !skipPatterns.some(pattern => lower.includes(pattern));
            });
            
            cleanedText = paragraphs.slice(0, 10).join('\n\n'); // Take first 10 good paragraphs
        }

        // Extract links from the original document
        const links = [...doc.querySelectorAll('a')]
            .map(a => a.href)
            .filter(href => href && href.startsWith('http'))
            .slice(0, 10);

        // Final cleanup
        cleanedText = cleanedText
            .replace(/\s+/g, ' ')
            .replace(/\n\s*\n/g, '\n')
            .trim();

        // Fix common character encoding issues
        cleanedText = fixCharacterEncoding(cleanedText);

        console.log('[Offscreen] Final result:', cleanedText.length, 'characters,', links.length, 'links');
        console.log('[Offscreen] First 300 chars:', cleanedText.substring(0, 300) + '...');
        
        // Special debugging for McKinsey emails
        if (htmlString.toLowerCase().includes('mckinsey')) {
            console.log('[Offscreen] === MCKINSEY EMAIL DEBUG ===');
            console.log('[Offscreen] Original HTML length:', htmlString.length);
            console.log('[Offscreen] Extracted text length:', cleanedText.length);
            console.log('[Offscreen] HTML contains "mckinsey":', htmlString.toLowerCase().includes('mckinsey'));
            console.log('[Offscreen] Text contains "mckinsey":', cleanedText.toLowerCase().includes('mckinsey'));
            console.log('[Offscreen] HTML sample (first 500 chars):', htmlString.substring(0, 500));
            console.log('[Offscreen] === END MCKINSEY DEBUG ===');
        }

        return { 
            text: cleanedText, 
            links: [...new Set(links)] 
        };

    } catch (error) {
        console.error("Offscreen content extraction failed completely:", error);
        // Ultimate fallback
        const textOnly = htmlString.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return { text: fixCharacterEncoding(textOnly), links: [] };
    }
}

/**
 * Fixes common character encoding issues that occur when UTF-8 text is misinterpreted.
 * @param {string} text - The text to fix
 * @returns {string} - The cleaned text with proper characters
 */
function fixCharacterEncoding(text) {
    // DIRECT CHARACTER DEBUGGING - Show exactly what we're seeing
    console.log('[Offscreen] === DIRECT CHARACTER DEBUG ===');
    
    // Take a sample that contains the problematic characters
    const sample = text.substring(0, 1000);
    
    // Find the exact sequences from your console output
    const directProblems = [];
    for (let i = 0; i < sample.length - 2; i++) {
        const char3 = sample.substring(i, i + 3);
        const char2 = sample.substring(i, i + 2);
        
        // Look for the exact sequences you showed me
        if (char3.includes('â€') || char2.includes('â€')) {
            directProblems.push({
                position: i,
                sequence: char3,
                codes: Array.from(char3).map(c => c.charCodeAt(0))
            });
        }
    }
    
    if (directProblems.length > 0) {
        console.log('[Offscreen] Found problematic sequences:');
        directProblems.slice(0, 5).forEach((prob, idx) => {
            console.log(`[Offscreen] ${idx + 1}. Position ${prob.position}: "${prob.sequence}" = [${prob.codes.join(', ')}]`);
        });
    }
    
    // Also show raw character codes for first 100 chars
    const firstChars = sample.substring(0, 100);
    const charCodes = Array.from(firstChars).map(c => c.charCodeAt(0));
    console.log('[Offscreen] First 100 character codes:', charCodes);
    
    // Show any non-ASCII characters directly
    const nonAscii = [];
    for (let i = 0; i < Math.min(sample.length, 200); i++) {
        const code = sample.charCodeAt(i);
        if (code > 127) {
            nonAscii.push({ char: sample[i], code: code, position: i });
        }
    }
    
    if (nonAscii.length > 0) {
        console.log('[Offscreen] Non-ASCII characters found:');
        nonAscii.slice(0, 10).forEach(item => {
            console.log(`[Offscreen] Position ${item.position}: "${item.char}" = ${item.code}`);
        });
    }
    
    console.log('[Offscreen] === END DIRECT DEBUG ===');
    
    // Common UTF-8 encoding artifacts and their correct replacements
    const encodingFixes = [
        // Smart quotes and apostrophes - more comprehensive patterns
        [/â€™/g, "'"],           // Right single quotation mark
        [/â€˜/g, "'"],           // Left single quotation mark
        [/â€œ/g, '"'],           // Left double quotation mark
        [/â€\u009D/g, '"'],      // Right double quotation mark (alternative encoding)
        [/â€/g, '"'],            // Right double quotation mark (catch remaining)
        
        // Dashes - various encodings
        [/â€"/g, '—'],           // Em dash
        [/â€"/g, '–'],           // En dash
        [/â€\u0093/g, '—'],      // Em dash alternative
        [/â€\u0092/g, '–'],      // En dash alternative
        
        // More comprehensive quote fixes
        [/â€\u0098/g, "'"],      // Left single quote
        [/â€\u0099/g, "'"],      // Right single quote
        [/â€\u009C/g, '"'],      // Left double quote
        
        // Ellipsis and bullets
        [/â€¦/g, '…'],           // Horizontal ellipsis
        [/â€¢/g, '•'],           // Bullet
        [/â€\u00A6/g, '…'],      // Ellipsis alternative
        
        // Non-breaking spaces and similar
        [/Â\u00A0/g, ' '],       // Non-breaking space
        [/Â /g, ' '],            // Non-breaking space alternative
        [/Â/g, ''],             // Isolated Â characters
        
        // Prime symbols
        [/â€²/g, '′'],           // Prime symbol
        [/â€³/g, '″'],           // Double prime symbol
        
        // Currency and special symbols
        [/â‚¬/g, '€'],           // Euro symbol
        [/Â£/g, '£'],            // Pound symbol
        [/Â¥/g, '¥'],            // Yen symbol
        [/Â©/g, '©'],            // Copyright symbol
        [/Â®/g, '®'],            // Registered trademark
        [/â„¢/g, '™'],           // Trademark symbol
        [/Â°/g, '°'],            // Degree symbol
        [/Â±/g, '±'],            // Plus-minus symbol
        [/Â½/g, '½'],            // One half
        [/Â¼/g, '¼'],            // One quarter
        [/Â¾/g, '¾'],            // Three quarters
        
        // Accented characters (comprehensive)
        [/Ã¡/g, 'á'], [/Ã /g, 'à'], [/Ã¢/g, 'â'], [/Ã£/g, 'ã'], [/Ã¤/g, 'ä'], [/Ã¥/g, 'å'],
        [/Ã©/g, 'é'], [/Ã¨/g, 'è'], [/Ãª/g, 'ê'], [/Ã«/g, 'ë'],
        [/Ã­/g, 'í'], [/Ã¬/g, 'ì'], [/Ã®/g, 'î'], [/Ã¯/g, 'ï'],
        [/Ã³/g, 'ó'], [/Ã²/g, 'ò'], [/Ã´/g, 'ô'], [/Ãµ/g, 'õ'], [/Ã¶/g, 'ö'], [/Ã¸/g, 'ø'],
        [/Ãº/g, 'ú'], [/Ã¹/g, 'ù'], [/Ã»/g, 'û'], [/Ã¼/g, 'ü'],
        [/Ã±/g, 'ñ'], [/Ã§/g, 'ç'], [/Ã¿/g, 'ÿ'],
        
        // Capital accented characters
        [/Ã\u0081/g, 'Á'], [/Ã\u0080/g, 'À'], [/Ã\u0082/g, 'Â'], [/Ã\u0083/g, 'Ã'], [/Ã\u0084/g, 'Ä'], [/Ã\u0085/g, 'Å'],
        [/Ã\u0089/g, 'É'], [/Ã\u0088/g, 'È'], [/Ã\u008A/g, 'Ê'], [/Ã\u008B/g, 'Ë'],
        [/Ã\u008D/g, 'Í'], [/Ã\u008C/g, 'Ì'], [/Ã\u008E/g, 'Î'], [/Ã\u008F/g, 'Ï'],
        [/Ã\u0093/g, 'Ó'], [/Ã\u0092/g, 'Ò'], [/Ã\u0094/g, 'Ô'], [/Ã\u0095/g, 'Õ'], [/Ã\u0096/g, 'Ö'], [/Ã\u0098/g, 'Ø'],
        [/Ã\u009A/g, 'Ú'], [/Ã\u0099/g, 'Ù'], [/Ã\u009B/g, 'Û'], [/Ã\u009C/g, 'Ü'],
        [/Ã\u0091/g, 'Ñ'], [/Ã\u0087/g, 'Ç'],
        
        // Generic â€ cleanup - catch any remaining sequences
        [/â€[^\w\s]/g, ' '],     // Replace â€ followed by non-word, non-space chars
        [/â€\s/g, ' '],          // Replace â€ followed by space
        [/â€$/g, ''],            // Replace â€ at end of string
        [/â€/g, ' '],            // Replace any remaining â€ sequences
        
        // Clean up multiple spaces and weird spacing
        [/\s{2,}/g, ' '],        // Multiple spaces to single space
        [/\u00A0+/g, ' '],       // Non-breaking spaces to regular spaces
        [/[\u2000-\u200F]/g, ' '], // Various Unicode spaces to regular space
        [/[\u2028-\u2029]/g, ' ']  // Line/paragraph separators to space
    ];
    
    let cleanedText = text;
    
    // Apply all encoding fixes
    encodingFixes.forEach(([pattern, replacement]) => {
        const before = cleanedText.length;
        cleanedText = cleanedText.replace(pattern, replacement);
        const after = cleanedText.length;
        if (before !== after) {
            console.log(`[Offscreen] Applied fix: ${pattern} -> "${replacement}" (${before - after} chars changed)`);
        }
    });
    
    // Final check - log any remaining weird characters
    const remainingWeird = cleanedText.match(/[â€™â€œâ€\u0080-\u009F\u00A0-\u00FF]/g);
    if (remainingWeird && remainingWeird.length > 0) {
        console.log('[Offscreen] Remaining encoding issues:', [...new Set(remainingWeird)]);
    }
    
    return cleanedText.trim();
} 