# 📧 Inbox Digest - AI-Powered Newsletter Summarizer

An intelligent Chrome extension that uses OpenAI's GPT-4o to create personalized newsletter digests and build a knowledge web of insights over time.

## 🚀 Quick Start (MVP Testing)

### 1. Set Up Your API Keys

1.  **Open `src/lib/config.js`:** This is where you'll add your secret keys.
2.  **Add Your OpenAI API Key:**
    *   Get a key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
    *   Paste it into the `OPENAI_API_KEY` variable.
3.  **Add Your Google Client ID:**
    *   Get an ID from the [Google Cloud Console](https://developer.chrome.com/docs/extensions/how-to/get-started/oauth).
    *   Paste it into the `GOOGLE_CLIENT_ID` variable in `config.js`.
4.  **Update the Manifest:**
    *   Open `manifest.json`.
    *   Replace `"YOUR_GOOGLE_CLIENT_ID_FROM_CONFIG_JS"` with the same Client ID from the previous step.
5.  **IMPORTANT: Add to `.gitignore`:** To keep your keys safe, ensure your `config.js` file is ignored by Git. Add the following line to your `.gitignore` file:
    ```
    src/lib/config.js
    ```

### 2. Load the Extension in Chrome

*   Open Chrome and go to `chrome://extensions/`.
*   Enable "Developer mode".
*   Click "Load unpacked".
*   Select the **entire `InboxDigest` project folder**.
*   The extension should now be installed.

### 3. Test the System

1.  **Configure Preferences:**
    *   Click the extension icon and go to "⚙️ Settings".
    *   Fill in your occupation and current work to personalize the AI.
2.  **Summarize Your Latest Email:**
    *   Click the extension icon.
    *   Click "📧 Summarize Latest Email".
    *   A Google sign-in window will appear for the first time. Grant permission.
    *   The summary of your latest email will appear in the popup.

## 🔧 How API Keys Are Handled

-   This project uses a simple `src/lib/config.js` file to manage API keys for development.
-   **This method is for local development only.** The `config.js` file contains your secret keys and should **never** be committed to version control.
-   For a public product, you must use a secure backend server to protect your keys.

## 🐛 Known Limitations (MVP)

-   **Full Digest**: The "Generate Full Digest" feature still uses sample data.
-   **Knowledge Web**: The AI analysis functions are still skeleton implementations.
-   **Error Handling**: Basic error messages are in place, but could be enhanced.

## 🧪 Testing Scenarios

### Scenario 1: Basic Summarization
- Paste any newsletter content in the quick test
- Verify the AI generates a coherent summary

### Scenario 2: Personalization
- Set your occupation and current work in settings
- Generate a digest and see how it's tailored to your context

### Scenario 3: Knowledge Web
- Generate multiple digests over time
- Check the insights page for trends and patterns

### Scenario 4: Export/Import
- Use the export feature to save your data
- Verify the JSON structure contains all your information

## 🔧 Technical Details

### Architecture
- **Frontend**: HTML/CSS/JavaScript (no framework)
- **AI**: OpenAI GPT-4o API
- **Storage**: Chrome Storage API
- **Background**: Service Worker for scheduling

### Key Features
- ✅ OpenAI API integration
- ✅ Personalized content filtering
- ✅ Multi-step summarization pipeline
- ✅ Knowledge web with trend analysis
- ✅ Export/import functionality
- ✅ Responsive UI

### File Structure
```
src/
├── lib/                 # Core logic
│   ├── openai-handler.js    # AI integration
│   ├── knowledge-web.js     # Insights engine
│   ├── personalization.js   # User preferences
│   └── digest-generator.js  # Main orchestrator
├── popup/              # Extension popup
├── options/            # Settings page
├── insights/           # Knowledge web dashboard
├── setup/              # Initial setup
├── digest/             # Digest display
└── styles/             # Global styles
```

## 🚧 Next Steps

1. **Implement Gmail API integration**
2. **Complete knowledge web AI functions**
3. **Add network visualization**
4. **Enhance error handling and retry logic**
5. **Add more sophisticated scheduling**

## 💡 Tips for Testing

- Start with the quick test to verify API connectivity
- Use realistic newsletter content for better results
- Set meaningful occupation/current work for better personalization
- Generate multiple digests to see knowledge web in action
- Check browser console for detailed logs

## 🆘 Troubleshooting

**"API key test failed"**
- Verify your OpenAI API key is correct
- Check your OpenAI account has credits
- Ensure you're using the correct API endpoint

**"No relevant emails found"**
- This is expected with sample data
- The system is designed to filter content based on your preferences

**Extension not loading**
- Check Chrome's extension page for errors
- Ensure all files are present in the directory
- Try reloading the extension

---

**Happy Testing! 🎉**

This MVP demonstrates the core concept of AI-powered newsletter summarization with personalization and knowledge building. The foundation is solid for adding more sophisticated features. 