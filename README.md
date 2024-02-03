# Fiverr Filla

A Chrome extension that uses **Groq AI** to generate and autofill your entire Fiverr presence — gig pages, seller profile, work experience, bio, and skills — all from one click.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green?style=for-the-badge)
![Groq AI](https://img.shields.io/badge/Groq-llama--3.3--70b-orange?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

---

## Features

### Gig Editor
- **AI Title** — Compelling "I will..." titles under 80 characters
- **Auto Tags** — 5 relevant gig search tags
- **3-Tier Packages** — Basic / Standard / Premium with names, descriptions, prices
- **Formatted Description** — Hook + bullets + CTA, 1000–1200 chars, injected into Fiverr's editor
- **5 FAQs** — Buyer-focused Q&A pairs, auto-added one by one
- **Buyer Requirements** — Auto-fills and marks required
- **Per-Gig Niche Input** — A niche bar is injected directly on each gig page; type a different niche per gig without touching the popup

### Seller Profile
- **Bio / About** — Professional seller bio personalized with your name, years of experience, and country
- **Work Experience** — Full entry (title, company, employment type, date, description) auto-filled and submitted
- **Skills** — Picks 6 relevant skills from Fiverr's actual skill database, auto-selects each with experience level

### General
- **Stop Button** — Every AI button becomes a Stop button while running; click to abort mid-task
- **Human-like Typing** — Character-by-character input with natural delays
- **Multi-key Rotation** — Up to 3 Groq API keys, auto-rotated on rate limit
- **Bundled Skill & Company Lists** — 360+ real Fiverr skills and common companies ship with the extension — no fetching required
- **Profile Info** — Save your name, years of experience, and country once; used across bio, work exp, and skills generation

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

1. Click the extension icon → **API Keys** tab
2. Paste your Groq API key (free at [console.groq.com](https://console.groq.com))
3. Click **◆ Save Keys**
4. Go to **Keywords** tab → fill in your profile info (name, years, country) and profile niche
5. Click **◆ Save Profile**

---

## How to Use

### Gig Pages
1. Go to **Selling → Gigs → Create a New Gig** (or edit existing)
2. A **◆ Niche** bar appears at the top of the editor — type your gig niche there
   > e.g. `logo design, branding, vector art`
3. Click any **◆ Generate** button to fill that field
4. Review and click **Save & Continue**

### Profile Page (`fiverr.com/sellers/.../edit`)
- **◆ Generate About** — fills your bio section
- **◆ Generate Work Experience** — opens the modal and fills every field automatically
- **◆ Add Skills** — selects 6 relevant skills from Fiverr's dropdown

### Pages Supported

| Page | Fields Filled |
|---|---|
| Overview | Title + 5 Tags |
| Pricing | Package names, descriptions, prices |
| Description & FAQ | Formatted description + 5 FAQs |
| Requirements | Buyer requirements |
| Profile → About | Bio (personalized) |
| Profile → Work Experience | Full entry with company, dates, description |
| Profile → Skills | 6 relevant skills with experience level |

---

## Project Structure

```
fiverr-ai-autofill/
├── manifest.json       # MV3 config — extension name, permissions
├── background.js       # Service worker — Groq API calls, key rotation
├── content.js          # Injected into Fiverr — all AI buttons and automation
├── styles.css          # Injected button and niche bar styles
├── popup.html          # Popup UI — Profile, API Keys, Model tabs
├── popup.js            # Popup logic — save/load profile and keys
├── fetch-lists.js      # One-time console script to fetch skills from Fiverr API
├── data/
│   ├── skills.json     # 360+ real Fiverr skills (bundled)
│   └── companies.json  # Common company names for work experience
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## How It Works

```
User fills niche bar on gig page (or profile niche in popup)
        ↓
◆ Generate button clicked
        ↓
content.js builds prompt with niche + profile info (name, years, country)
        ↓
background.js calls Groq API (llama-3.3-70b-versatile)
        ↓
Response is typed character-by-character into Fiverr's fields
using React-compatible events (nativeInputValueSetter + InputEvent)
so Fiverr registers it as real user input
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Extension | Chrome MV3, Vanilla JS |
| AI | Groq Cloud — `llama-3.3-70b-versatile` |
| Storage | `chrome.storage.sync` (keys/model) + `chrome.storage.local` (profile/skills) |
| Skill data | Fiverr autocomplete API (pre-fetched, bundled as JSON) |

---

## Notes

- API keys are stored in `chrome.storage.sync` — sent only to `api.groq.com`, never anywhere else
- Groq's free tier handles hundreds of requests per day at no cost
- The niche bar on gig pages is per-session — it doesn't persist between page loads (intentional, since each gig is different)
- Skills and companies are bundled with the extension — no internet fetch needed on first run

---

## License

MIT — free to use, modify, and distribute.

---

## Author

Built by [Nadir Ali Khan](https://www.theteamnak.com) · [GitHub](https://github.com/NadirAliOfficial)
