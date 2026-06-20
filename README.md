# ⚡ Fiverr Gig AI Autofill

A Chrome extension that uses **Groq AI** to instantly generate and autofill your Fiverr gig — title, description, pricing packages, and FAQs — with one click.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green?style=for-the-badge)
![Groq AI](https://img.shields.io/badge/Powered%20by-Groq%20AI-orange?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## Features

- **AI-Generated Gig Title** — Compelling "I will..." titles under 80 characters
- **Professional Description** — Structured descriptions with hooks, bullet points, and CTAs
- **3-Tier Packages** — Auto-generated Basic, Standard, and Premium package details with pricing
- **FAQ Generation** — 4 buyer-focused Q&A pairs tailored to your gig niche
- **Fill All at Once** — One button fills every field on the page
- **Draggable Floating Panel** — Non-intrusive, stays out of your way
- **Works on SPA Navigation** — Follows Fiverr's multi-step gig editor across all tabs

---

## Demo

> Open any Fiverr gig create or edit page → the **⚡ Gig AI Fill** panel appears in the top-right corner.

1. Type your gig niche/topic
2. Click a field button or **✨ Fill All**
3. Watch your gig write itself

---

## Installation

### Load Unpacked (Developer Mode)

1. Clone or download this repository
   ```bash
   git clone https://github.com/NadirAliOfficial/fiverr-ai-autofill.git
   ```

2. Open Chrome and go to `chrome://extensions`

3. Enable **Developer mode** (toggle in the top-right)

4. Click **Load unpacked** and select the `fiverr-ai-autofill` folder

5. The extension icon will appear in your Chrome toolbar

---

## Setup

### Get a Free Groq API Key

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up / log in
3. Navigate to **API Keys** → Create a new key
4. Copy the key (starts with `gsk_...`)

### Add Key to Extension

1. Click the **⚡ Gig AI Fill** extension icon in Chrome
2. Paste your Groq API key
3. Click **Save Key**

---

## Usage

1. Go to [fiverr.com](https://www.fiverr.com) and open any gig create or edit page
2. The floating panel appears automatically in the top-right corner
3. Enter a short description of your gig in the text area

   > Example: *"I will design a professional logo for your brand using Adobe Illustrator"*

4. Click the button for what you want to generate:

| Button | What It Fills |
|---|---|
| 📝 **Title** | Gig title (max 80 chars, "I will..." format) |
| 📄 **Description** | Full professional gig description |
| 📦 **Packages** | Basic / Standard / Premium names, descriptions, prices |
| ❓ **FAQs** | 4 common buyer question & answer pairs |
| ✨ **Fill All** | Everything above in one shot |

5. Review the generated content and make any edits before publishing

---

## Project Structure

```
fiverr-ai-autofill/
├── manifest.json        # Chrome Extension Manifest V3 config
├── background.js        # Service worker — handles Groq API requests
├── content.js           # Injected into Fiverr pages — panel UI + field filling
├── styles.css           # Floating panel styles
├── popup.html           # Extension popup — API key input
├── popup.js             # Popup logic — save/load API key
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How It Works

```
User types gig topic
       ↓
content.js builds a prompt
       ↓
Sends message to background.js (service worker)
       ↓
background.js calls Groq API (llama-3.3-70b-versatile)
       ↓
Response parsed and injected into Fiverr's DOM fields
(React synthetic events triggered so Fiverr registers the changes)
```

The extension uses **React-compatible DOM injection** — it triggers native `input`, `change`, and `blur` events so Fiverr's React frontend recognizes the filled values as real user input.

---

## Supported Fiverr Pages

- `fiverr.com/new-gig` — New gig creation
- `fiverr.com/users/*/manage_gigs/*/edit` — Existing gig editing

The panel auto-appears on these pages and hides on all other Fiverr pages.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Extension | Chrome MV3, Vanilla JS |
| AI Model | Groq — `llama-3.3-70b-versatile` |
| API | Groq Cloud API (OpenAI-compatible) |
| Styling | Pure CSS, dark theme |

---

## Notes

- Your API key is stored locally in `chrome.storage.sync` — never sent anywhere except directly to Groq's API
- Groq's free tier is generous — hundreds of requests per day at no cost
- If a field isn't found, the extension will show a hint telling you which tab to navigate to in Fiverr's gig editor

---

## License

MIT — free to use, modify, and distribute.

---

## Author

Built by [NadirAliOfficial](https://github.com/NadirAliOfficial)
