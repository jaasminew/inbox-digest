/**
 * Utility functions for Inbox Digest
 */

/**
 * Format a date in a user-friendly way
 * @param {Date} date - The date to format
 * @param {string} format - The format to use (short, medium, long)
 * @returns {string} Formatted date string
 */
export function formatDate(date, format = 'medium') {
  const options = {
    short: { month: 'short', day: 'numeric' },
    medium: { month: 'long', day: 'numeric', year: 'numeric' },
    long: { 
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    }
  };

  return new Intl.DateTimeFormat('en-US', options[format]).format(date);
}

/**
 * Format a time duration in a user-friendly way
 * @param {number} minutes - Duration in minutes
 * @returns {string} Formatted duration string
 */
export function formatDuration(minutes) {
  if (minutes < 1) {
    return 'less than a minute';
  }

  if (minutes < 60) {
    return `${Math.round(minutes)} minute${minutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);

  if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`;
}

/**
 * Truncate text to a specified length
 * @param {string} text - The text to truncate
 * @param {number} maxLength - Maximum length
 * @param {string} suffix - Suffix to add if truncated
 * @returns {string} Truncated text
 */
export function truncateText(text, maxLength = 100, suffix = '...') {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Generate a random color based on a string
 * @param {string} str - The string to generate color from
 * @returns {string} Hex color code
 */
export function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Debounce a function
 * @param {Function} func - The function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle a function
 * @param {Function} func - The function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export function throttle(func, limit) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Generate a unique ID
 * @returns {string} Unique ID
 */
export function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Sanitize HTML string
 * @param {string} html - The HTML string to sanitize
 * @returns {string} Sanitized HTML string
 */
export function sanitizeHTML(html) {
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

/**
 * Copy text to clipboard
 * @param {string} text - The text to copy
 * @returns {Promise<boolean>} Success status
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy text:', err);
    return false;
  }
}

/**
 * Download content as a file
 * @param {string} content - The content to download
 * @param {string} filename - The filename
 * @param {string} type - The MIME type
 */
export function downloadFile(content, filename, type = 'text/plain') {
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

/**
 * Get file extension from filename
 * @param {string} filename - The filename
 * @returns {string} File extension
 */
export function getFileExtension(filename) {
  return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
}

/**
 * Format file size in a human-readable way
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Check if a value is empty
 * @param {*} value - The value to check
 * @returns {boolean} True if empty
 */
export function isEmpty(value) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  return false;
}

/**
 * Deep clone an object
 * @param {*} obj - The object to clone
 * @returns {*} Cloned object
 */
export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj);
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item));
  }

  if (obj instanceof Object) {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, deepClone(value)])
    );
  }
}

/**
 * Merge two objects deeply
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
export function deepMerge(target, source) {
  const output = deepClone(target);

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = deepMerge(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}

/**
 * Check if a value is an object
 * @param {*} value - The value to check
 * @returns {boolean} True if object
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
} 