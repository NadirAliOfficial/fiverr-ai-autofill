# Fiverr Gig AI Autofill

A Chrome extension that uses **Groq AI** to generate and autofill your Fiverr gig — title, tags, packages, description, FAQs, and buyer requirements — page by page.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green?style=for-the-badge)
![Groq AI](https://img.shields.io/badge/Groq-llama--3.3--70b-orange?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## Features

- **AI-Generated Title** — Compelling "I will..." titles under 80 characters
- **Auto Tags** — 5 relevant gig tags typed naturally into Fiverr's tag input
- **3-Tier Packages** — Basic / Standard / Premium with names, descriptions, and prices
- **Formatted Description** — Hook + bullets + CTA, 1000–1200 chars, injected into Fiverr's Quill editor
- **5 FAQs** — Unique buyer-focused Q&A pairs, auto-added one by one
- **Buyer Requirements** — Auto-fills the requirements textarea and marks it required
- **Human-like Typing** — Character-by-character input with natural delays (anti-detection)
- **Toggle On/Off** — Hide all AI buttons from the page with one switch in the popup
- **Multi-key Rotation** — Add up to 3 Groq API keys; auto-rotates on rate limit

---

## Installation

1. Clone this repository
   ```bash
   git clone https://github.com/NadirAliOfficial/fiverr-ai-autofill.git
   ```

2. Open Chrome → `chrome://extensions`

3. Enable **Developer mode** (top-right toggle)

4. Click **Load unpacked** → select the `fiverr-ai-autofill` folder

5. The ✦ icon appears in your Chrome toolbar

---

## Setup

1. Click the extension icon to open the popup
2. Go to the **API Keys** tab
3. Paste your Groq API key (get one free at [console.groq.com](https://console.groq.com))
4. Click **◆ Save Keys**

No config files needed — everything is stored in the extension's secure storage.

---

## How to Use

1. Open the popup → **Keywords** tab → type your gig niche
   > Example: `ibkr bot, python, algo trading, metatrader`
2. Click **◆ Save Keywords**
3. Go to Fiverr → **Selling → Gigs → Create a New Gig**
4. On each page you'll see small **◆ Generate** buttons next to each field
5. Click them to generate and autofill — review, then **Save & Continue**

### Pages Supported

| Page | Fields Filled |
|---|---|
| Overview | Title + 5 Tags |
| Pricing | Package names, descriptions, prices |
| Description & FAQ | Formatted description + 5 FAQs |
| Requirements | Buyer requirements textarea |

---

## Project Structure

```
fiverr-ai-autofill/
├── manifest.json     # MV3 config
├── background.js     # Service worker — Groq API calls, key rotation
├── content.js        # Injected into Fiverr — generate buttons + field filling
├── styles.css        # Field button styles
├── popup.html        # Popup UI — Keywords, API Keys, Model tabs
├── popup.js          # Popup logic
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How It Works

```
User saves keywords in popup
        ↓
◆ Generate button clicked on Fiverr page
        ↓
content.js builds a prompt with the keywords
        ↓
background.js calls Groq API (llama-3.3-70b-versatile)
        ↓
Response is typed character-by-character into Fiverr's fields
(React-compatible events fired so Fiverr registers real input)
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Extension | Chrome MV3, Vanilla JS |
| AI | Groq Cloud — `llama-3.3-70b-versatile` |
| Styling | Pure CSS, dark theme |
| Storage | `chrome.storage.sync` (keys) + `chrome.storage.local` (keywords/settings) |

---

## Notes

- API keys are stored in `chrome.storage.sync` — only sent directly to `api.groq.com`, never anywhere else
- Groq's free tier handles hundreds of requests per day at no cost
- The toggle in the popup lets you hide all AI buttons if you want a clean Fiverr experience

---

## License

MIT — free to use, modify, and distribute.

---

## Author

Built by [Nadir Ali Khan](https://www.theteamnak.com) · [GitHub](https://github.com/NadirAliOfficial)
