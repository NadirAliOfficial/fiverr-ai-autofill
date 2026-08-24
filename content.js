const GIG_PATTERN     = /fiverr\.com\/users\/[^/]+\/manage_gigs/;
const PROFILE_PATTERN = /fiverr\.com\/sellers\/[^/]+\/edit/;

let apiKey = '';
let faiKeywords = '';
let faiEnabled = true;
let _faiStop = false;

chrome.storage.sync.get(['groqApiKey'], ({ groqApiKey }) => { apiKey = groqApiKey || ''; });
chrome.storage.local.get(['faiKeywords', 'faiEnabled'], (data) => {
  faiKeywords = data.faiKeywords || '';
  faiEnabled = data.faiEnabled !== false;
});

function getProfile() {
  return new Promise(r => chrome.storage.local.get(['faiName', 'faiYears', 'faiCountry'], r));
}

// Import from localStorage if fetch-lists.js just ran (saved there as bridge)
(function importLocalStorage() {
  try {
    const c = JSON.parse(localStorage.getItem('faiCompanies') || 'null');
    const s = JSON.parse(localStorage.getItem('faiSkills')    || 'null');
    if (c?.length > 0 || s?.length > 0) {
      const data = {};
      if (c?.length > 0) data.faiCompanies = c;
      if (s?.length > 0) data.faiSkills    = s;
      chrome.storage.local.set(data);
      localStorage.removeItem('faiCompanies');
      localStorage.removeItem('faiSkills');
    }
  } catch (e) {}
})();

// Load bundled lists from data/*.json — only if storage is empty (never overwrites fetched data)
async function loadBundledLists() {
  try {
    const existing = await new Promise(r => chrome.storage.local.get(['faiCompanies', 'faiSkills'], r));
    const needCompanies = !existing.faiCompanies?.length;
    const needSkills    = !existing.faiSkills?.length;
    if (!needCompanies && !needSkills) return;

    const [cRes, sRes] = await Promise.all([
      fetch(chrome.runtime.getURL('data/companies.json')),
      fetch(chrome.runtime.getURL('data/skills.json')),
    ]);
    const companies = await cRes.json();
    const skills    = await sRes.json();
    const toSet = {};
    if (needCompanies && companies?.length > 0) toSet.faiCompanies = companies;
    if (needSkills    && skills?.length > 0)    toSet.faiSkills    = skills;
    if (Object.keys(toSet).length) await new Promise(r => chrome.storage.local.set(toSet, r));
  } catch (e) {}
}
loadBundledLists();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.groqApiKey) apiKey = changes.groqApiKey.newValue || '';
  if (area === 'local') {
    if (changes.faiKeywords) faiKeywords = changes.faiKeywords.newValue || '';
    if (changes.faiEnabled !== undefined) {
      faiEnabled = changes.faiEnabled.newValue !== false;
      applyEnabledState();
    }
  }
});

function applyEnabledState() {
  document.querySelectorAll('.fai-field-btn').forEach(b => {
    b.style.display = faiEnabled ? '' : 'none';
  });
  if (faiEnabled) scanAndInject();
}

// ── Anti-detection ────────────────────────────────────────────────────────────

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return _faiStop ? Promise.resolve() : new Promise(r => setTimeout(r, ms)); }
function humanDelay() { return sleep(rand(400, 900)); }

async function humanType(el, text) {
  el.focus();
  await sleep(rand(80, 180));
  const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  nativeSetter ? nativeSetter.call(el, '') : (el.value = '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(rand(40, 80));
  let current = '';
  for (const char of text) {
    current += char;
    nativeSetter ? nativeSetter.call(el, current) : (el.value = current);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(rand(18, 52));
    if (Math.random() < 0.05) await sleep(rand(120, 350));
  }
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(rand(60, 130));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

async function typeTag(input, tag) {
  await humanType(input, tag);
  await sleep(rand(150, 280));
  ['keydown', 'keypress', 'keyup'].forEach(e =>
    input.dispatchEvent(new KeyboardEvent(e, { key: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  );
  await sleep(rand(280, 500));
  if (input.value.trim()) {
    ['keydown', 'keypress', 'keyup'].forEach(e =>
      input.dispatchEvent(new KeyboardEvent(e, { key: ',', keyCode: 188, which: 188, bubbles: true }))
    );
    const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    ns ? ns.call(input, '') : (input.value = '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(rand(200, 380));
  }
}

// ── Groq ──────────────────────────────────────────────────────────────────────

function getKeywords() {
  if (GIG_PATTERN.test(location.href)) {
    const inp = document.getElementById('fai-gig-niche');
    // Use bar value if present, otherwise fall back to sessionStorage (persisted from earlier page)
    return (inp ? inp.value.trim() : '') || sessionStorage.getItem('faiGigNiche') || '';
  }
  return faiKeywords;
}

function setMsg() {} // no-op: status shown in button state

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// AI output sometimes title-cases acronyms into a broken half-capitalized form
// (e.g. "Eas", "Apis") instead of the correct "EAs", "APIs" — fix deterministically
// since prompt instructions alone aren't reliable enough for this.
function fixAcronyms(text) {
  const acronyms = ['EA', 'API', 'MT4', 'MT5', 'AI', 'UI', 'UX', 'SEO', 'CRM', 'CSV', 'PDF'];
  let fixed = text;
  for (const a of acronyms) {
    fixed = fixed.replace(new RegExp(`\\b${a}s\\b`, 'gi'), `${a}s`);
    fixed = fixed.replace(new RegExp(`\\b${a}\\b`, 'gi'), a);
  }
  return fixed;
}

async function ask(prompt, system, temperature) {
  const res = await chrome.runtime.sendMessage({
    type: 'GROQ_REQUEST',
    payload: { apiKey, prompt, systemPrompt: system, temperature }
  });
  if (res.error) throw new Error(res.error);
  return res.result;
}

// Pick a random item so repeated generations for the same keyword take a different creative angle
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function findByNearbyText(selector, pattern, maxDepth = 6) {
  const all = [...document.querySelectorAll('h3,h4,h5,p,label,div,span')];
  const heading = all.find(el => el.children.length === 0 && pattern.test(el.textContent.trim()));
  if (!heading) return null;
  let node = heading;
  for (let i = 0; i < maxDepth; i++) {
    node = node.parentElement;
    if (!node) break;
    const found = node.querySelector(selector);
    if (found && isVisible(found)) return found;
  }
  return null;
}

// ── Inline button factory ─────────────────────────────────────────────────────

function makeBtn(label, onClick) {
  const btn = document.createElement('button');
  btn.className = 'fai-field-btn';
  btn.textContent = label;
  let running = false;
  const setStatus = (text) => { if (running) btn.textContent = text; };
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // While running → act as Stop button
    if (running) {
      _faiStop = true;
      running = false;
      btn.textContent = label;
      return;
    }
    const kw = getKeywords();
    if (!kw) {
      btn.textContent = '⚠ Set keywords first';
      setTimeout(() => { btn.textContent = label; }, 2200);
      return;
    }
    _faiStop = false;
    running = true;
    btn.textContent = '◼ Stop';
    try {
      await onClick(kw, setStatus);
      if (!_faiStop) {
        btn.textContent = '✓ Done';
        setTimeout(() => { btn.textContent = label; running = false; }, 2500);
      } else {
        btn.textContent = label;
        running = false;
      }
    } catch (err) {
      running = false;
      btn.textContent = _faiStop ? label : ('✗ ' + err.message.slice(0, 36));
      if (!_faiStop) setTimeout(() => { btn.textContent = label; }, 3500);
    }
  });
  return btn;
}

// ── Gig niche bar (injected once at top of gig editor) ────────────────────────

function injectNicheBar() {
  if (document.getElementById('fai-niche-bar')) return;
  const anchor = (
    document.querySelector('textarea[placeholder*="I will"]') ||
    document.querySelector('input[placeholder*="I will"]') ||
    document.querySelector('textarea[maxlength="80"]')
  );
  if (!anchor) return;

  // Walk up until we find the editor column container (wider than 500px)
  let container = anchor;
  for (let i = 0; i < 12; i++) {
    if (!container.parentElement) break;
    container = container.parentElement;
    if (container.offsetWidth > 500) break;
  }

  const bar = document.createElement('div');
  bar.id = 'fai-niche-bar';
  bar.className = 'fai-niche-bar';
  bar.innerHTML = `
    <label>◆ Niche</label>
    <input id="fai-gig-niche" type="text" autocomplete="off">
    <span>powers all AI buttons</span>
  `;
  container.before(bar);

  // Rotate placeholder examples
  const nicheInput = bar.querySelector('#fai-gig-niche');

  // Restore saved niche for this gig session
  const saved = sessionStorage.getItem('faiGigNiche');
  if (saved) nicheInput.value = saved;

  // Persist on every keystroke so it survives wizard page navigation
  nicheInput.addEventListener('input', () => {
    sessionStorage.setItem('faiGigNiche', nicheInput.value);
  });

  const examples = [
    'logo design, branding, vector art',
    'algo trading bot, MT5, Pine Script',
    'wordpress site, landing page, Elementor',
    'video editing, YouTube shorts, reels',
    'python automation, web scraping, API',
    'mobile app, React Native, Flutter',
    'SEO articles, blog writing, copywriting',
    'dropshipping, Shopify, product listing',
    'voiceover, podcast editing, audio',
    'UI/UX design, Figma, prototyping',
  ];
  let _ni = 0;
  nicheInput.placeholder = `e.g. ${examples[0]}`;
  setInterval(() => {
    if (nicheInput.value) return;
    _ni = (_ni + 1) % examples.length;
    nicheInput.placeholder = `e.g. ${examples[_ni]}`;
  }, 3000);
}

// ── Page 1: Overview ──────────────────────────────────────────────────────────

function injectPage1() {
  injectNicheBar();
  // Title
  const titleEl = (
    document.querySelector('textarea[placeholder*="I will"]') ||
    document.querySelector('input[placeholder*="I will"]') ||
    document.querySelector('textarea[maxlength="80"]') ||
    document.querySelector('input[maxlength="80"]')
  );
  if (titleEl && !titleEl.dataset.faiDone) {
    titleEl.dataset.faiDone = '1';
    const btn = makeBtn('◆ Generate Title', async (kw) => {
      setMsg('Generating title…', 'info');
      const angle = pick([
        'Start with a strong action verb (build, develop, automate, create, design) followed by the tool/platform, then the outcome.',
        'Lead with the specific tool or platform name first, then say what you do with it.',
        'Lead with the outcome/result the buyer gets, then mention how you deliver it.',
        'Start with a strong verb, but pick a less obvious one than build/develop/create — e.g. engineer, architect, launch, deploy, optimize.',
        'Frame it around solving a specific buyer problem, then name the tool used to solve it.',
      ]);
      const text = await ask(`Keywords: ${kw}`,
        `Write a short, SEO-optimized Fiverr gig title. The field already shows "I will" — write ONLY what comes after "I will". Do NOT include "I will".
Max 60 chars. Naturally include 1-2 of these keywords: ${kw}.
${angle}
Be specific and punchy: service + tool/platform + outcome. No filler words.
Avoid defaulting to the most generic, expected phrasing — this must read differently from a typical templated gig title.
NEVER mention or imply profits, earnings, returns, ROI, "guaranteed", "passive income", or any financial results — Fiverr bans income/profit guarantee claims in gig titles, especially for trading/finance gigs. Focus only on the service and deliverable, not money outcomes.
Preserve correct capitalization of technical acronyms exactly as written (EA, API, MT5, MT4, AI, etc.) — plural form adds a lowercase "s" with no case change, e.g. "EAs" not "Eas", "APIs" not "Apis".
Reply with ONLY the text, no quotes.`,
        1.0
      );
      const clean = fixAcronyms(text.replace(/^["']|["']$/g, '').trim().replace(/^i will\s+/i, '').trim());
      await humanType(titleEl, clean.slice(0, 73));
      setMsg('Title filled!', 'success');
    });
    titleEl.closest('div')?.after(btn);
  }

  // Tags
  const tagEl = (
    findByNearbyText('input', /positive keywords/i) ||
    findByNearbyText('input', /5 tags maximum/i) ||
    document.querySelector('input[placeholder*="tag" i]')
  );
  if (tagEl && !tagEl.dataset.faiDone) {
    tagEl.dataset.faiDone = '1';
    const btn = makeBtn('◆ Generate Tags', async (kw) => {
      setMsg('Adding tags…', 'info');
      const raw = await ask(`Keywords: ${kw}`,
        `Generate exactly 5 Fiverr search tags. lowercase, 1-3 words each, letters and numbers only, no special chars.
Return ONLY a comma-separated list. Example: algo trading, mt5 bot, python trading, expert advisor, automated trading`
      );
      const tags = raw.split(',').map(t => t.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '')).filter(Boolean).slice(0, 5);
      for (const tag of tags) { await typeTag(tagEl, tag); await humanDelay(); }
      setMsg('Tags added!', 'success');
    });
    tagEl.closest('div')?.after(btn);
  }
}

// ── Page 2: Pricing ───────────────────────────────────────────────────────────

function injectPage2() {
  injectNicheBar();
  const nameFields = [...document.querySelectorAll('textarea[placeholder*="Name your package"]')].slice(0, 3);
  if (!nameFields.length) return;

  const anchor = nameFields[0].closest('table, div[class*="package"], section') || nameFields[0].closest('div');
  if (anchor && !anchor.dataset.faiDone) {
    anchor.dataset.faiDone = '1';
    const btn = makeBtn('◆ Generate Packages', async (kw) => {
      setMsg('Generating packages…', 'info');
      const packagesPrompt = `Create 3 Fiverr packages for a gig about: ${kw}. Return ONLY valid JSON, no markdown code fences, no extra text:
{
  "basic":    { "name": "UNIQUE_NAME_1", "description": "...", "price": 30  },
  "standard": { "name": "UNIQUE_NAME_2", "description": "...", "price": 75  },
  "premium":  { "name": "UNIQUE_NAME_3", "description": "...", "price": 150 }
}
Rules:
- Top-level keys must be exactly "basic", "standard", "premium" (lowercase) — nothing else.
- Names: creative tier-appropriate names (NOT Basic/Standard/Premium). E.g. Starter, Growth, Pro, Elite, Essential, Advanced, Ultimate. Each must be DIFFERENT.
- Description: use the format 'This [Name] package includes [what's in it].' — 75-90 characters. Example: 'This Starter package includes a logo design with 2 revisions and the source file.' Adapt to the gig niche and tier scope.
- Prices: realistic for the gig type and tier (basic cheapest, premium highest).
- Escalate scope between tiers: basic = minimal, standard = full, premium = everything + extras.
JSON only.`;

      // Normalise whatever shape the model returns into {basic, standard, premium}
      function normalisePkgs(obj) {
        if (!obj || typeof obj !== 'object') return null;
        // Unwrap common wrapper keys
        const inner = obj.packages || obj.data || obj.result || obj;
        const lower = {};
        for (const k of Object.keys(inner)) lower[k.toLowerCase().trim()] = inner[k];
        if (lower.basic && lower.standard && lower.premium) return lower;
        return null;
      }

      async function generatePkgs() {
        const raw = await ask(`Keywords: ${kw}`, packagesPrompt);
        let parsed;
        try { parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]); }
        catch { return null; }
        return normalisePkgs(parsed);
      }

      let pkgs = await generatePkgs();
      if (!pkgs) {
        setMsg('Retrying package generation…', 'info');
        pkgs = await generatePkgs();
      }
      if (!pkgs) throw new Error('Invalid package data — try again');

      // Re-query at click time — Fiverr React may have re-rendered since inject
      const freshNames  = [...document.querySelectorAll('textarea[placeholder*="Name your package"]')].filter(isVisible).slice(0, 3);
      const freshDescs  = [...document.querySelectorAll('textarea[placeholder*="Describe the details"]')].filter(isVisible).slice(0, 3);
      const priceInputs = [...document.querySelectorAll('input[type="number"], input[type="text"]')]
        .filter(el => el.closest('td, [class*="price"]') && isVisible(el)).slice(0, 3);

      if (!freshNames.length) throw new Error('Package fields not found — scroll to the pricing table first');

      const tiers = ['basic', 'standard', 'premium'];
      for (let i = 0; i < 3; i++) {
        const pkg = pkgs[tiers[i]];
        if (!pkg) continue;
        setMsg(`Filling ${tiers[i]}…`, 'info');
        if (freshNames[i]) { await humanType(freshNames[i], pkg.name); await humanDelay(); }
        if (freshDescs[i]) { await humanType(freshDescs[i], pkg.description.trim().slice(0, 90)); await humanDelay(); }
        if (priceInputs[i]) { await humanType(priceInputs[i], String(pkg.price)); await humanDelay(); }
      }
      setMsg('Packages done!', 'success');
    });
    anchor.before(btn);
  }
}

// ── Wait helpers ──────────────────────────────────────────────────────────────

async function waitFor(selector, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el && isVisible(el)) return el;
    await sleep(200);
  }
  return null;
}

async function waitGone(selector, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (!el || !isVisible(el)) return true;
    await sleep(200);
  }
  return false;
}

// ── Page 3: Description & FAQ ─────────────────────────────────────────────────

function injectPage3() {
  injectNicheBar();
  // ── Description ──
  const editor = document.querySelector('.ql-editor[contenteditable="true"]');
  const toolbar = document.querySelector('.ql-toolbar');

  if (editor && toolbar && !toolbar.dataset.faiDone) {
    toolbar.dataset.faiDone = '1';
    const btn = makeBtn('◆ Generate Description', async (kw) => {
      setMsg('Generating description…', 'info');
      const hookStyle = pick([
        'Question the buyer is likely asking themselves, followed by a short confident reassurance. E.g. "Looking for a custom Chrome extension to automate tasks? You\'re in the right place!"',
        'A bold direct claim about the outcome you deliver, no question mark. E.g. "Your workflow shouldn\'t need 10 manual steps when one Chrome extension can do it."',
        'A short relatable pain point the buyer has, stated as fact. E.g. "Repetitive browser tasks eat hours every week that a simple extension could save."',
        'A confident one-line promise of the result, framed as a statement not a question.',
      ]);
      const whyStyle = pick([
        'Start each with action words or adjectives. E.g. "Clean, scalable, well-documented code".',
        'Start each with a number or concrete specific where possible. E.g. "3+ years building production Chrome extensions".',
        'Phrase each as a short benefit to the buyer rather than a trait about you. E.g. "You get working code, not just a demo".',
      ]);

      const data = await ask(`Keywords: ${kw}`,
        `Write a Fiverr gig description for: ${kw}. Return ONLY valid JSON with these exact keys:
{
  "hook": "...",
  "intro": "...",
  "develop": ["...", "...", "...", "...", "...", "...", "...", "..."],
  "why": ["...", "...", "...", "...", "...", "..."],
  "closing": "...",
  "cta": "..."
}
Rules:
- hook: ${hookStyle} 1 sentence, max 110 chars.
- intro: 1-2 sentences about your experience and who you build for. Mention years and client types.
- develop: exactly 8 specific things you can build/deliver for this niche. Short phrases, 4-8 words each. Diverse and specific to ${kw}.
- why: exactly 6 short selling points. 4-7 words each. ${whyStyle}
- closing: 1-2 sentences wrapping up the offer. Invite them to order.
- cta: one direct action sentence, 60-80 chars.
- Weave keywords from: ${kw}
- Avoid the most predictable, template-sounding phrasing — this should read differently each time it's generated, not like the same gig with nouns swapped.
- Output JSON only, no markdown, no char counts.`,
        0.95
      );

      let desc;
      try { desc = JSON.parse(data.match(/\{[\s\S]*\}/)?.[0]); }
      catch { throw new Error('Could not parse description — try again'); }
      if (!desc?.hook || !Array.isArray(desc.develop)) throw new Error('Bad description format — try again');
      const clean = s => String(s).replace(/\s*\(\d+.*?\)\s*/g, '').trim();
      desc.hook    = clean(desc.hook);
      desc.intro   = clean(desc.intro || '');
      desc.develop = (desc.develop || []).map(b => clean(b)).filter(Boolean).slice(0, 10);
      desc.why     = (desc.why || []).map(b => clean(b)).filter(Boolean).slice(0, 6);
      desc.closing = clean(desc.closing || '');
      desc.cta     = clean(desc.cta || '');

      editor.click();
      editor.focus();
      await sleep(rand(200, 350));

      // Clear editor
      document.execCommand('selectAll', false, null);
      await sleep(60);
      document.execCommand('delete', false, null);
      await sleep(150);
      editor.focus();
      await sleep(80);

      const esc = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const devHtml = desc.develop.map(b => `<li>${esc(b)}</li>`).join('');
      const whyHtml = desc.why.map(b => `<li>${esc(b)}</li>`).join('');
      const html = `<p>${esc(desc.hook)}</p><p><br></p>`
        + `<p>${esc(desc.intro)}</p><p><br></p>`
        + `<p><strong>I can develop:</strong></p><ul>${devHtml}</ul><p><br></p>`
        + `<p><strong>Why choose me?</strong></p><ul>${whyHtml}</ul><p><br></p>`
        + `<p>${esc(desc.closing)}</p><p><br></p>`
        + `<p>${esc(desc.cta)}</p>`;

      document.execCommand('insertHTML', false, html);
      await sleep(400);

      setMsg('Description filled!', 'success');
    });
    btn.style.marginBottom = '6px';
    btn.style.display = 'block';
    toolbar.before(btn);
  }

  // ── FAQs ──
  const faqHeading = [...document.querySelectorAll('h2,h3,h4,p,div,span')]
    .find(el => el.children.length === 0 && /frequently asked questions/i.test(el.textContent.trim()));

  if (faqHeading && !faqHeading.dataset.faiDone) {
    faqHeading.dataset.faiDone = '1';
    const btn = makeBtn('◆ Generate FAQs', async (kw) => {
      setMsg('Generating FAQs…', 'info');
      const concerns = [
        'How long will my project take? (give a concrete timeline with a reason)',
        'What if I need changes after delivery? (specific revision policy)',
        'What do you need from me to get started? (exact requirements)',
        'What exactly will I receive? (files, formats, source code, documentation etc.)',
        'Have you done this before? (specific past experience, tools used, numbers if possible)',
      ].sort(() => Math.random() - 0.5); // shuffle so questions don't always appear in the same order

      const voiceStyle = pick([
        'Sound confident and direct, short sentences.',
        'Sound warm and conversational, like a seller who genuinely enjoys the work.',
        'Sound efficient and no-nonsense, get straight to the specific facts.',
        'Sound like an experienced expert who has answered this a hundred times, calm and matter-of-fact.',
      ]);

      const raw = await ask(`Keywords: ${kw}`,
        `Write exactly 5 FAQs a real buyer would ask about a Fiverr gig for: ${kw}
Think like a buyer with a specific concern — not a generic template writer.
Cover these 5 real buyer concerns, in this order:
1. ${concerns[0]}
2. ${concerns[1]}
3. ${concerns[2]}
4. ${concerns[3]}
5. ${concerns[4]}
Return ONLY valid JSON array:
[
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." }
]
RULES:
- NEVER mention email, phone, WhatsApp, Telegram, Skype — Fiverr TOS violation.
- Questions: written as the buyer asking, casual and direct (e.g. "How long does it take?", "What do I get?").
- Answers: confident, personal, first-person. 2 sentences max. 180-240 chars. Use real specifics — tool names, day counts, file types, numbers. Sound like a real seller, not a template.
- BAD answer: "I will deliver high-quality results in a timely manner." GOOD answer: "Most projects take 3-5 days. I'll send you the full source code, manifest, and a setup guide."
- ${voiceStyle}
- Avoid reusing the most predictable phrasing — vary sentence structure and word choice so this doesn't read like a template filled in with different nouns.
JSON only, no markdown.`,
        0.95
      );
      let faqs;
      try { faqs = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0]); }
      catch { throw new Error('Could not parse FAQs — try again'); }

      function findAddFaqBtn() {
        return [...document.querySelectorAll('a, button, span')]
          .find(el => /^\+?\s*Add FAQ$/i.test(el.textContent.trim()) && isVisible(el));
      }

      for (let i = 0; i < Math.min(faqs.length, 5); i++) {
        if (_faiStop) break;
        setMsg(`Adding FAQ ${i + 1}/5…`, 'info');

        // Wait for form to be closed first (from previous Add click)
        await waitGone('input[placeholder*="Add a Question" i]', 3000);
        await sleep(rand(300, 500));

        // Click "+ Add FAQ" to open the form
        const addBtn = findAddFaqBtn();
        if (!addBtn) { setMsg(`"+ Add FAQ" not found at entry ${i + 1}`, 'error'); break; }
        addBtn.click();

        // Wait for form inputs to appear
        const qEl = await waitFor('input[placeholder*="Add a Question" i]', 5000);
        const aEl = await waitFor('textarea[placeholder*="Add an Answer" i]', 5000);
        if (!qEl || !aEl) { setMsg(`FAQ form didn't open at entry ${i + 1}`, 'error'); break; }

        await sleep(rand(200, 400));
        await humanType(qEl, faqs[i].question);
        await humanDelay();
        await humanType(aEl, faqs[i].answer.slice(0, 265));
        await humanDelay();

        // Click "Add" to save
        const saveBtn = [...document.querySelectorAll('button')]
          .find(el => el.textContent.trim() === 'Add' && isVisible(el));
        if (!saveBtn) { setMsg(`"Add" button not found at FAQ ${i + 1}`, 'error'); break; }
        saveBtn.click();
        await sleep(rand(500, 800));
      }
      setMsg('All 5 FAQs added!', 'success');
    });
    faqHeading.after(btn);
  }
}

// ── Page 4: Requirements ─────────────────────────────────────────────────────

function injectPage4() {
  injectNicheBar();
  // Detect by the requirements textarea placeholder
  const reqTextarea = document.querySelector('textarea[placeholder*="Request necessary details" i]');
  const heading = [...document.querySelectorAll('h2,h3,h4,p,div,span')]
    .find(el => el.children.length === 0 && /your questions/i.test(el.textContent.trim()));

  const anchor = heading || reqTextarea;
  if (!anchor || anchor.dataset.faiDone) return;
  anchor.dataset.faiDone = '1';

  const btn = makeBtn('◆ Generate Requirements', async (kw) => {
    setMsg('Generating requirements…', 'info');
    const raw = await ask(`Keywords: ${kw}`,
      `Write 3 buyer requirement questions for a Fiverr gig about: ${kw}
These are questions the seller asks the buyer when they place an order.
Return ONLY valid JSON array:
[
  { "question": "...", "required": true },
  { "question": "...", "required": true },
  { "question": "...", "required": false }
]
Rules:
- Each question under 380 characters
- Ask for: 1) project specs/details, 2) technical preferences/requirements, 3) timeline or extra info
- Be specific to the gig type
- required: true for essential info, false for optional
JSON only.`
    );

    let reqs;
    try { reqs = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0]); }
    catch { throw new Error('Could not parse requirements — try again'); }

    for (let i = 0; i < reqs.length; i++) {
      if (_faiStop) break;
      setMsg(`Adding requirement ${i + 1}/${reqs.length}…`, 'info');

      if (i > 0) {
        await waitGone('textarea[placeholder*="Request necessary details" i]', 4000);
        await sleep(rand(300, 500));

        const addBtn = [...document.querySelectorAll('button, a, span')]
          .find(el => /add (a )?question/i.test(el.textContent.trim()) && isVisible(el));
        if (!addBtn) { setMsg(`"Add Question" button not found at req ${i + 1}`, 'error'); break; }
        addBtn.click();
        await sleep(rand(400, 700));
      }

      const textarea = await waitFor('textarea[placeholder*="Request necessary details" i]', 5000);
      if (!textarea) { setMsg(`Requirement form not found at entry ${i + 1}`, 'error'); break; }

      await sleep(rand(150, 300));
      await humanType(textarea, reqs[i].question.slice(0, 380));
      await humanDelay();

      // Check "Required" if needed
      if (reqs[i].required) {
        const checkbox = document.querySelector('input[type="checkbox"]');
        if (checkbox && !checkbox.checked) {
          checkbox.click();
          await sleep(rand(150, 300));
        }
      }

      // Click "Add" to save
      const saveBtn = [...document.querySelectorAll('button')]
        .find(el => el.textContent.trim() === 'Add' && isVisible(el));
      if (!saveBtn) { setMsg(`"Add" button not found at req ${i + 1}`, 'error'); break; }
      saveBtn.click();
      await sleep(rand(500, 800));
    }
    setMsg('Requirements added!', 'success');
  });

  if (heading) heading.after(btn);
  else reqTextarea.closest('div')?.before(btn);
}

// ── Page 5: Gallery — AI image prompt generator ───────────────────────────────

function injectPage5() {
  injectNicheBar();

  const heading = [...document.querySelectorAll('h1,h2,h3,h4')]
    .find(el => /gallery|show off your (best )?work|images? (&|and) video/i.test(el.textContent.trim()));
  const dropzone = document.querySelector('input[type="file"][accept*="image" i]');
  const anchor = heading || dropzone?.closest('div');
  if (!anchor || anchor.dataset.faiGalleryDone) return;
  anchor.dataset.faiGalleryDone = '1';

  // Color palettes — [background hex, name, accent hex, accent name]
  const PALETTES = [
    ['#05080F', 'pure deep black', '#FFB800', 'gold'],
    ['#0A0F1E', 'deep navy', '#00D9FF', 'electric cyan'],
    ['#12080A', 'near-black charcoal red', '#FF3B30', 'crimson red'],
    ['#0B0F0C', 'deep forest black', '#39FF88', 'neon green'],
    ['#0D0A14', 'deep violet-black', '#C77DFF', 'vivid purple'],
    ['#FFFFFF', 'pure white', '#0057FF', 'royal blue'],
    ['#0F0B08', 'deep espresso black', '#FF8A00', 'burnt orange'],
  ];

  // Layout skeletons — each returns the full prompt given the content fields
  const LAYOUTS = [
    // A: stacked two-line massive title, centered, icons scattered corners/mid-sides
    (d, bg, accent, logoLines) => `Create a premium Fiverr gig thumbnail, 1536x1024 pixels.
One unified full image. NO split panels. NO divider lines. NO cards. NO feature lists.
Bold typography center. Relevant tool/platform icons surrounding it.

BACKGROUND: ${bg[1]} (${bg[0]}) across the entire image. Completely clean and unified — no patterns, no grid, no textures, no columns.

CENTER OF IMAGE (main focal point): massive ultra-bold Anton or Montserrat Black font, 2 lines, perfectly centered:
Line 1: "${d.line1}" — pure ${bg[0] === '#FFFFFF' ? 'black' : 'white'}, absolutely enormous
Line 2: "${d.line2}" — ${accent[1]} (${accent[0]}), even bigger than line 1, dominates the image

Below title, one thin horizontal ${accent[1]} line. Below that, one single clean light gray text line: "${d.subtitle}"
That is all the text on the entire image.

ICONS/LOGOS, arranged organically around the title like planets around a center, not in a row, each large and instantly recognizable:
${logoLines}

STYLE: minimal dark tech poster, extreme negative space, clean and premium.
DO NOT include: split lines, divider panels, feature cards, stat badges, bottom logo rows, particle effects, human figures, charts, money imagery, website URL, hexagon badges, clutter of any kind.`,

    // B: single dominant word large, second word smaller below it, icons in a loose bottom arc
    (d, bg, accent, logoLines) => `Create a premium Fiverr gig thumbnail, 1536x1024 pixels. One unified image, no panels, no borders, no grid lines.

BACKGROUND: solid ${bg[1]} (${bg[0]}), completely flat and clean.

UPPER-CENTER TEXT: the single word "${d.line2}" in massive ultra-bold condensed sans-serif (Anton style), filling most of the horizontal width, color ${accent[1]} (${accent[0]}), with a soft ${accent[1]} glow behind it.
Directly above it, smaller: "${d.line1}" in plain white, roughly a quarter the size of the word below.
Beneath both, one small light gray line: "${d.subtitle}".

LOWER HALF: the following icons arranged in a loose, uneven arc across the bottom third of the image, varying sizes, generous spacing, none overlapping the text:
${logoLines}

STYLE: bold poster energy, like a movie title card. Premium, confident, minimal.
DO NOT include: borders, panels, grids, human figures, charts, money imagery, screenshots, watermarks, extra text beyond what is specified.`,

    // C: title in a rounded badge/pill, slightly tilted, icons only in the four corners
    (d, bg, accent, logoLines) => `Create a premium Fiverr gig thumbnail, 1536x1024 pixels. One unified image, no split panels, no dividers, no feature cards.

BACKGROUND: ${bg[1]} (${bg[0]}) with an extremely subtle diagonal gradient toward a slightly darker shade of the same color — barely visible, still reads as a flat unified background.

CENTER: a rounded rectangular badge/pill shape, tilted about 4 degrees for energy, outlined with a thin ${accent[1]} border, containing the two-line bold title stacked inside it:
Line 1: "${d.line1}" in white
Line 2: "${d.line2}" in ${accent[1]} (${accent[0]}), larger than line 1
Directly beneath the badge, outside it: one small light gray line reading "${d.subtitle}".

FOUR CORNERS ONLY: place one recognizable icon in each corner, large and clear, generous margin from the edges — do not fill the corners with more than one icon each:
${logoLines}

STYLE: confident, modern, slightly dynamic due to the tilt. Premium poster energy, extreme cleanliness elsewhere.
DO NOT include: extra badges, stat lines, charts, human figures, money imagery, screenshots, clutter of any kind.`,

    // D: left-aligned asymmetric title, icons in a vertical column on the right
    (d, bg, accent, logoLines) => `Create a premium Fiverr gig thumbnail, 1536x1024 pixels. One unified image, editorial poster layout, asymmetric composition — NOT centered.

BACKGROUND: flat ${bg[1]} (${bg[0]}), completely clean, no textures or gradients.

LEFT TWO-THIRDS OF IMAGE: massive bold stacked title, left-aligned, starting near the left edge:
Line 1: "${d.line1}" in white, large
Line 2: "${d.line2}" in ${accent[1]} (${accent[0]}), even larger, bold enough to dominate the left side
Beneath the title, left-aligned, one small light gray line: "${d.subtitle}".

RIGHT ONE-THIRD OF IMAGE: the following icons stacked vertically down the right edge, evenly spaced with generous gaps, each clearly visible and not touching the title text:
${logoLines}

STYLE: modern editorial tech poster, strong asymmetry, lots of negative space around the icon column.
DO NOT include: dividing lines between the two sections, borders, panels, human figures, charts, money imagery, clutter of any kind.`,
  ];

  const btn = makeBtn('◆ Generate Image Prompt', async (kw, setStatus) => {
    setStatus('⟳ Writing image prompt…');
    const raw = await ask(`Keywords: ${kw}`,
      `Design the text and icon content for a premium Fiverr gig thumbnail poster about: ${kw}.
Return ONLY valid JSON:
{
  "line1": "FIRST BOLD WORD (1-2 words, ALL CAPS, the general category — e.g. PYTHON, WEB DESIGN, VIDEO EDITING)",
  "line2": "SECOND BOLD WORD (1 word, ALL CAPS, the standout highlight — e.g. PRO, EXPERT, BOT, SERVICES — bigger than line1)",
  "subtitle": "3-5 short related keywords separated by a bullet, relevant to this exact gig",
  "logos": ["Name1", "Name2", "Name3", "Name4", "Name5", "Name6"]
}
Rules:
- line1 and line2 together form the poster's main title — short, punchy, together read like a service name.
- line2 must be a high-impact power word that maximizes click-through when a buyer scans small search thumbnails — e.g. PRO, EXPERT, MASTER, NINJA, WIZARD, GURU, DONE-FOR-YOU, ON-DEMAND. Pick whichever fits the niche's tone best (playful niches can use NINJA/WIZARD, technical/corporate niches should use PRO/EXPERT/MASTER).
- logos: real, well-known software/tool/platform names strongly associated with this niche (e.g. for a Python gig: Python, Django, Flask, PostgreSQL, Docker, AWS). If the niche has no well-known brand tools, return short generic icon descriptions instead (e.g. "gear icon", "paintbrush icon", "camera icon"). Provide up to 6.
JSON only, no markdown.`
    );

    let d;
    try { d = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]); } catch { d = null; }
    if (!d || !d.line1 || !d.line2) throw new Error('Could not build image prompt — try again');
    d.line1 = d.line1.toUpperCase();
    d.line2 = d.line2.toUpperCase();

    const positions = ['top-left area', 'top-right area', 'bottom-left area', 'bottom-right area', 'far left middle', 'far right middle'];
    const logoLines = (d.logos || []).slice(0, 6)
      .map((l, i) => `${positions[i] || 'scattered'}: ${l} logo/icon`)
      .join('\n');

    const bg = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const accent = [bg[2], bg[3]];
    const buildPrompt = LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)];
    const ctrNote = `\n\nOPTIMIZE FOR CLICK-THROUGH: this image will appear tiny in Fiverr search results, competing against dozens of other thumbnails. Maximum contrast between text and background so the title is instantly legible even at thumbnail size. Bold, confident, scroll-stopping — not subtle or muted.`;
    const prompt = buildPrompt(d, bg, accent, logoLines) + ctrNote;

    try {
      await navigator.clipboard.writeText(prompt);
      setStatus('✓ Copied — paste into ChatGPT');
    } catch (_) {
      // Clipboard blocked — fall back to showing it in a prompt dialog for manual copy
      window.prompt('Copy this prompt (Cmd/Ctrl+C):', prompt);
    }
    await sleep(1800);
  });

  if (heading) heading.after(btn);
  else anchor.before(btn);
}

// Traverse up from el to find a visible button matching pattern (up to maxLevels ancestors)
function findNearbyBtn(el, pattern, maxLevels = 12) {
  let node = el;
  for (let i = 0; i < maxLevels; i++) {
    node = node.parentElement;
    if (!node) break;
    const found = [...node.querySelectorAll('button, a, span')]
      .find(b => pattern.test(b.textContent.trim()) && isVisible(b));
    if (found) return found;
  }
  return null;
}

// ── API interceptor injected into page context ────────────────────────────────
// Overrides fetch/XHR so we capture Fiverr's raw API responses containing
// company and skill lists — no letter-cycling, just one dropdown open per list.

function injectApiInterceptor() {
  if (document.getElementById('fai-interceptor')) return;
  const s = document.createElement('script');
  s.id = 'fai-interceptor';
  s.textContent = `(function(){
    if (window.__faiActive) return;
    window.__faiActive = true;

    function emit(url, text) {
      try {
        const data = JSON.parse(text);
        window.dispatchEvent(new CustomEvent('__faiCapture', { detail: { url, data } }));
      } catch(e) {}
    }

    const oFetch = window.fetch;
    window.fetch = async function(...a) {
      const url = typeof a[0] === 'string' ? a[0] : (a[0]?.url || '');
      const res = await oFetch.apply(this, a);
      res.clone().text().then(t => emit(url, t)).catch(() => {});
      return res;
    };

    const oOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, url) {
      this.__fUrl = url || '';
      return oOpen.apply(this, arguments);
    };
    const oSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener('load', () => emit(this.__fUrl, this.responseText));
      return oSend.apply(this, arguments);
    };
  })();`;
  (document.head || document.documentElement).appendChild(s);
}

// Resolve when any captured API response contains a list matching the predicate
function waitForCapture(predicate, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      window.removeEventListener('__faiCapture', handler);
      resolve(null);
    }, timeoutMs);

    function handler(e) {
      const result = predicate(e.detail.url, e.detail.data);
      if (result) {
        clearTimeout(timer);
        window.removeEventListener('__faiCapture', handler);
        resolve(result);
      }
    }
    window.addEventListener('__faiCapture', handler);
  });
}

// Recursively find all string arrays (≥4 items, items ≤120 chars) in an object
function extractStringArrays(obj, depth = 0) {
  if (depth > 8 || !obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    const names = obj
      .map(i => typeof i === 'string' ? i : (i?.name || i?.label || i?.title || i?.value || i?.text || null))
      .filter(s => s && typeof s === 'string' && s.length > 0 && s.length <= 120);
    if (names.length >= 4) return [names];
    return obj.flatMap(i => extractStringArrays(i, depth + 1));
  }
  return Object.values(obj).flatMap(v => extractStringArrays(v, depth + 1));
}

// ── Fetch company list via API interception ───────────────────────────────────

async function fetchCompanies(setStatus) {
  const ONE_DAY = 86400000;
  const cached = await new Promise(r => chrome.storage.local.get(['faiCompanies', 'faiListsDate'], r));
  if (cached.faiCompanies?.length > 0 && Date.now() - (cached.faiListsDate || 0) < ONE_DAY) {
    return cached.faiCompanies;
  }

  injectApiInterceptor();

  setStatus('⟳ Scrolling to Work Experience…');
  let expHeading = [...document.querySelectorAll('h1,h2,h3,h4')]
    .find(el => /work experience/i.test(el.textContent.trim()));

  // Lazy-rendered — scroll down gradually to trigger render
  if (!expHeading) {
    for (let i = 0; i < 20; i++) {
      window.scrollBy(0, 400);
      await sleep(200);
      expHeading = [...document.querySelectorAll('h1,h2,h3,h4')]
        .find(el => /work experience/i.test(el.textContent.trim()));
      if (expHeading) break;
    }
  }
  if (!expHeading) return [];

  expHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(1000);

  setStatus('⟳ Opening work exp modal…');
  const addBtn = findNearbyBtn(expHeading, /add new/i);
  if (!addBtn) return [];
  addBtn.click();

  const titleInput = await waitFor('input[placeholder="Title"]', 7000);
  if (!titleInput) return [];
  await sleep(rand(400, 600));

  // Click company trigger to make Fiverr call its API
  const compTrigger = [...document.querySelectorAll('div, button, span')]
    .find(el => isVisible(el) && /^company name$/i.test(el.textContent.trim()) && el.children.length <= 4);

  let companies = [];

  if (compTrigger) {
    compTrigger.click();
    await sleep(rand(500, 700));

    const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    const compInput = document.activeElement?.tagName === 'INPUT' ? document.activeElement
      : [...document.querySelectorAll('input')].find(inp => isVisible(inp) && inp !== titleInput && inp.type !== 'checkbox');

    if (compInput) {
      // Collect all via interceptor — one letter per request, covers full a-z company database
      const allSet = new Set();
      const accumulate = (e) => {
        extractStringArrays(e.detail.data)
          .filter(a => a.length >= 3 && a.every(s => s.length < 80))
          .forEach(a => a.forEach(s => allSet.add(s)));
      };
      window.addEventListener('__faiCapture', accumulate);

      for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
        ns ? ns.call(compInput, letter) : (compInput.value = letter);
        compInput.dispatchEvent(new Event('input', { bubbles: true }));
        compInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        await sleep(1200);
        // DOM fallback — broad selector
        [...document.querySelectorAll('[role="option"], [role="listbox"] li, [class*="option"], [class*="suggestion"], [class*="autocomplete"] li, [class*="dropdown"] li')]
          .filter(el => isVisible(el) && el.textContent.trim().length > 0 && el.textContent.trim().length < 80
            && !/no more options|no options|no results|loading/i.test(el.textContent.trim()))
          .forEach(el => allSet.add(el.textContent.trim()));
        setStatus(`⟳ Companies: ${allSet.size} found (scanning '${letter}'…)`);
        if (allSet.size >= 500) break;
      }

      window.removeEventListener('__faiCapture', accumulate);
      companies = [...allSet];
    }
  }

  // Close modal without saving
  const cancelBtn = [...document.querySelectorAll('button')]
    .find(el => /^cancel$/i.test(el.textContent.trim()) && isVisible(el));
  if (cancelBtn) cancelBtn.click();
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitGone('input[placeholder="Title"]', 5000);
  await sleep(rand(300, 500));

  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (companies.length > 0) {
    await new Promise(r => chrome.storage.local.set({ faiCompanies: companies, faiListsDate: Date.now() }, r));
  }
  return companies;
}

// ── Fetch skill list via API interception ─────────────────────────────────────

async function fetchSkills(setStatus) {
  const ONE_DAY = 86400000;
  const cached = await new Promise(r => chrome.storage.local.get(['faiSkills', 'faiSkillsDate'], r));
  if (cached.faiSkills?.length > 0 && Date.now() - (cached.faiSkillsDate || 0) < ONE_DAY) {
    return cached.faiSkills;
  }

  injectApiInterceptor();

  setStatus('⟳ Scrolling to Skills…');
  let skillsHeading = [...document.querySelectorAll('h1,h2,h3,h4')]
    .find(el => /skills and expertise/i.test(el.textContent.trim()));

  if (!skillsHeading) {
    for (let i = 0; i < 30; i++) {
      window.scrollBy(0, 400);
      await sleep(200);
      skillsHeading = [...document.querySelectorAll('h1,h2,h3,h4')]
        .find(el => /skills and expertise/i.test(el.textContent.trim()));
      if (skillsHeading) break;
    }
  }
  if (!skillsHeading) return [];

  skillsHeading.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await sleep(800);

  setStatus('⟳ Opening skills modal…');

  const addSkillBtn = findNearbyBtn(skillsHeading, /add new/i);
  if (!addSkillBtn) return [];
  addSkillBtn.click();

  const SKILL_INPUT_SEL = 'input[placeholder*="JavaScript" i], input[placeholder*="skill" i], input[placeholder*="expertise" i]';
  const skillInput = await waitFor(SKILL_INPUT_SEL, 7000);
  if (!skillInput) return [];
  await sleep(rand(300, 500));

  setStatus('⟳ Triggering skill API…');
  const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  // Race API capture with a broad trigger term
  const allSkills = new Set();

  // One term per major Fiverr category — covers ALL fields, not just one niche
  const CATEGORY_TRIGGERS = [
    // Graphics & Design
    'logo','illustration','photoshop','figma','ui','3d','branding','banner',
    // Digital Marketing
    'seo','social','email','ads','ppc','tiktok','instagram','youtube',
    // Writing & Translation
    'content','copywriting','translation','proofreading','blog','article',
    // Video & Animation
    'video','animation','editing','motion','explainer',
    // Music & Audio
    'music','voiceover','podcast','mixing','audio',
    // Programming & Tech
    'python','javascript','php','java','node','react','wordpress','shopify',
    'android','ios','flutter','blockchain','chatbot','automation','api','sql',
    // Business
    'virtual assistant','data entry','excel','accounting','research','typing',
    // AI
    'ai','machine learning','deep learning',
    // Lifestyle & Other
    'coaching','fitness','cooking',
  ];

  const accumulate = (e) => {
    extractStringArrays(e.detail.data)
      .filter(a => a.length >= 3 && a.every(s => s.length < 100))
      .forEach(a => a.forEach(s => allSkills.add(s)));
  };
  window.addEventListener('__faiCapture', accumulate);

  for (const term of CATEGORY_TRIGGERS) {
    ns ? ns.call(skillInput, term) : (skillInput.value = term);
    skillInput.dispatchEvent(new Event('input', { bubbles: true }));
    skillInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    await sleep(1100);

    // DOM fallback — broad selector, filter noise
    [...document.querySelectorAll('[role="option"], [role="listbox"] li, [class*="option"], [class*="suggestion"], [class*="autocomplete"] li, [class*="dropdown"] li')]
      .filter(el => isVisible(el) && el.textContent.trim().length > 0 && el.textContent.trim().length < 100
        && !/no more options|no options|no results|loading/i.test(el.textContent.trim()))
      .forEach(el => allSkills.add(el.textContent.trim()));

    setStatus(`⟳ Skills: ${allSkills.size} found (scanning '${term}'…)`);
    if (allSkills.size >= 1000) break;
  }

  window.removeEventListener('__faiCapture', accumulate);

  // Cancel modal
  const cancelBtn = [...document.querySelectorAll('button')]
    .find(el => /cancel/i.test(el.textContent.trim()) && isVisible(el));
  if (cancelBtn) cancelBtn.click();
  else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await waitGone(SKILL_INPUT_SEL, 5000);
  await sleep(rand(300, 500));

  const skills = [...allSkills];
  if (skills.length > 0) {
    await new Promise(r => chrome.storage.local.set({ faiSkills: skills, faiSkillsDate: Date.now() }, r));
  }
  return skills;
}

// ── Profile: About ────────────────────────────────────────────────────────────

function injectAbout() {
  const heading = [...document.querySelectorAll('h1,h2,h3,h4')]
    .find(el => /^about$/i.test(el.textContent.trim()));
  if (!heading || heading.dataset.faiDone) return;

  // Walk up ancestors to find the section containing a textarea
  let textarea = null;
  let node = heading.parentElement;
  for (let i = 0; i < 8 && node; i++) {
    textarea = node.querySelector('textarea');
    if (textarea) break;
    node = node.parentElement;
  }
  if (!textarea) return;

  heading.dataset.faiDone = '1';
  const btn = makeBtn('◆ Generate About', async (kw, setStatus) => {
    setStatus('⟳ Generating bio…');
    const p = await getProfile();
    const ctx = [p.faiName && `Name: ${p.faiName}`, p.faiYears && `${p.faiYears} years experience`, p.faiCountry && `Based in ${p.faiCountry}`].filter(Boolean).join(', ');
    const text = await ask(`Niche: ${kw}`,
      `Write a professional Fiverr seller "About" bio for a freelancer in: ${kw}.${ctx ? '\nFreelancer details: ' + ctx + '.' : ''}
3-4 sentences. Mention experience, core skills from the niche, and what makes them stand out.
End with a short CTA like "Message me to get started."
Max 500 characters. Plain text only — no markdown, no bullet points, no line breaks.`
    );
    setStatus('⟳ Typing…');
    await humanType(textarea, text.trim().slice(0, 500));
  });
  heading.after(btn);
}

// ── Profile: Work Experience ──────────────────────────────────────────────────

function injectWorkExp() {
  const heading = [...document.querySelectorAll('h1,h2,h3,h4')]
    .find(el => /work experience/i.test(el.textContent.trim()));
  if (!heading || heading.dataset.faiWorkDone) return;
  heading.dataset.faiWorkDone = '1';

  const btn = makeBtn('◆ Generate Work Experience', async (kw, setStatus) => {
    setStatus('⟳ Loading company list…');
    const stored = await new Promise(r => chrome.storage.local.get(['faiCompanies'], r));
    const companyList = stored.faiCompanies?.length > 0
      ? stored.faiCompanies
      : ['LinkedIn', 'Upwork', 'Fiverr', 'TradingView', 'Freelancer'];
    // Shuffle so AI gets a varied ordering each call — prevents always picking the first company
    const shuffled = [...companyList].sort(() => Math.random() - 0.5);
    const companyStr = shuffled.slice(0, 60).join(', ');

    setStatus('⟳ Generating entry…');
    const p = await getProfile();
    const ctx = [p.faiName && `Name: ${p.faiName}`, p.faiYears && `${p.faiYears} years experience`, p.faiCountry && `Based in ${p.faiCountry}`].filter(Boolean).join(', ');
    const raw = await ask(`Niche: ${kw}`,
      `Create one realistic freelance work experience entry for a freelancer specialising in: ${kw}.${ctx ? '\nFreelancer: ' + ctx + '.' : ''}
Niche: ${kw}
Return ONLY valid JSON:
{
  "title": "Job title relevant to the niche",
  "company": "Pick ONE company from this list that fits best as the platform or employer — do NOT default to the first item, pick whichever suits the niche: ${companyStr}",
  "currentlyWorking": true,
  "description": "3-4 sentences describing what you built, the technologies/tools used, the problems solved, and the outcomes. 400-550 chars. No markdown. Do NOT mention ratings, star ratings, prices, earnings, client counts, percentages, or platform metrics."
}
JSON only.`
    );
    let exp;
    try { exp = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]); }
    catch { throw new Error('Parse failed — try again'); }

    // Ensure company is actually in the fetched list
    const match = companyList.find(c => c.toLowerCase() === exp.company?.toLowerCase())
      || companyList.find(c => exp.company?.toLowerCase().includes(c.toLowerCase()))
      || companyList[0];
    exp.company = match;

    setStatus('⟳ Opening modal…');
    const addBtn = findNearbyBtn(heading, /add new/i);
    if (!addBtn) throw new Error('"Add new" not found');
    addBtn.click();

    setStatus('⟳ Waiting for modal…');
    const titleInput = await waitFor('input[placeholder="Title"]', 7000);
    if (!titleInput) throw new Error('Modal did not open — try again');
    await sleep(rand(400, 600));

    setStatus('⟳ Filling title…');
    await humanType(titleInput, exp.title);
    await humanDelay();

    // Employment type → click dropdown, pick "Freelance"
    setStatus('⟳ Selecting employment type…');
    const empTrigger = [...document.querySelectorAll('div, button, span')]
      .find(el => isVisible(el) && /^employment type/i.test(el.textContent.trim()) && el.textContent.trim().length < 60);
    if (empTrigger) {
      empTrigger.click();
      await sleep(rand(400, 600));
      const freelanceOpt = [...document.querySelectorAll('li, [role="option"], div')]
        .find(el => isVisible(el) && /^freelance$/i.test(el.textContent.trim()));
      if (freelanceOpt) { freelanceOpt.click(); await sleep(rand(300, 500)); }
    }

    // Company name
    setStatus('⟳ Selecting company…');

    // Snapshot existing inputs BEFORE opening the dropdown so we can detect the new search input
    const inputsBefore = new Set([...document.querySelectorAll('input')]);

    // Find the company trigger: match by aria-label/placeholder/textContent, then pick the
    // SHORTEST textContent match (most specific element, not its outer wrapper)
    const compCandidates = [...document.querySelectorAll(
      '[role="combobox"], [role="button"], button, div[tabindex="0"], div[tabindex], span[tabindex], input, div, span'
    )].filter(el => {
      if (!isVisible(el)) return false;
      const text = (el.textContent || '').trim();
      const label = el.getAttribute('aria-label') || '';
      const ph = el.getAttribute('placeholder') || '';
      return /company.?name/i.test(text + ' ' + label + ' ' + ph) && text.length < 60;
    });
    const compTrigger = compCandidates.length
      ? compCandidates.reduce((best, el) =>
          el.textContent.trim().length < best.textContent.trim().length ? el : best)
      : null;

    if (compTrigger) {
      compTrigger.focus();
      compTrigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      compTrigger.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window }));
      compTrigger.click();
      await sleep(rand(900, 1300));

      // Find a NEW input that appeared after the dropdown opened
      const compInput = [...document.querySelectorAll('input')]
        .find(inp => !inputsBefore.has(inp) && isVisible(inp))
        || (document.activeElement?.tagName === 'INPUT' ? document.activeElement : null)
        || [...document.querySelectorAll('input')]
            .find(inp => isVisible(inp) && inp !== titleInput && inp.type !== 'checkbox');

      if (compInput) {
        const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        compInput.focus();
        ns ? ns.call(compInput, '') : (compInput.value = '');
        compInput.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(80);

        let cur = '';
        for (const ch of exp.company) {
          compInput.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
          cur += ch;
          ns ? ns.call(compInput, cur) : (compInput.value = cur);
          compInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          compInput.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true }));
          compInput.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
          await sleep(rand(50, 90));
        }
        await sleep(rand(1200, 1600));

        const anchorRect = compInput.getBoundingClientRect();
        const safeCompany = exp.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const compRe = new RegExp(safeCompany, 'i');

        // Collect all candidates, then pick the DEEPEST one (no other match is a descendant of it)
        const compCands = [...document.querySelectorAll('p, li, [role="option"], div, span')]
          .filter(el => {
            if (!isVisible(el)) return false;
            const r = el.getBoundingClientRect();
            if (r.width < 20 || r.height < 8) return false;
            if (r.top < anchorRect.bottom - 10) return false;
            const t = el.textContent.trim();
            return t.length > 0 && t.length < 100 && compRe.test(t);
          });
        const compOpt = compCands.find(el => !compCands.some(o => o !== el && el.contains(o)))
          || compCands[0];

        if (compOpt) {
          compOpt.scrollIntoView({ block: 'nearest' });
          await sleep(80);
          const r = compOpt.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const ev = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
          compOpt.dispatchEvent(new PointerEvent('pointerover', ev));
          compOpt.dispatchEvent(new MouseEvent('mouseover', ev));
          compOpt.dispatchEvent(new PointerEvent('pointerdown', ev));
          compOpt.dispatchEvent(new MouseEvent('mousedown', ev));
          compOpt.dispatchEvent(new PointerEvent('pointerup', ev));
          compOpt.dispatchEvent(new MouseEvent('mouseup', ev));
          compOpt.dispatchEvent(new MouseEvent('click', ev));
          await sleep(rand(600, 900));
          // Do NOT click elsewhere — let Fiverr close the dropdown naturally
        } else {
          // Fallback: ArrowDown + Tab to pick first item and move focus out (no Escape)
          compInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
          await sleep(200);
          compInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
          await sleep(rand(300, 500));
        }
      } else {
        // No search input — dropdown exposes a plain list; pick matching item by position
        const triggerRect = compTrigger.getBoundingClientRect();
        const safeCompany2 = exp.company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const compOpt2 = [...document.querySelectorAll('p, li, [role="option"]')]
          .find(el => {
            if (!isVisible(el)) return false;
            const r = el.getBoundingClientRect();
            if (r.top < triggerRect.bottom - 10 || r.width < 20) return false;
            return new RegExp(safeCompany2, 'i').test(el.textContent.trim());
          });
        if (compOpt2) {
          compOpt2.scrollIntoView({ block: 'nearest' });
          await sleep(80);
          const r2 = compOpt2.getBoundingClientRect();
          const cx2 = r2.left + r2.width / 2, cy2 = r2.top + r2.height / 2;
          const ev2 = { bubbles: true, cancelable: true, view: window, clientX: cx2, clientY: cy2 };
          compOpt2.dispatchEvent(new MouseEvent('mousedown', ev2));
          compOpt2.dispatchEvent(new MouseEvent('mouseup', ev2));
          compOpt2.dispatchEvent(new MouseEvent('click', ev2));
          await sleep(rand(600, 900));
        }
      }
    }

    // "I currently work here" checkbox
    setStatus('⟳ Checking currently work here…');
    const cb = [...document.querySelectorAll('input[type="checkbox"]')].find(c => isVisible(c));
    if (cb && !cb.checked) {
      const cbLabel = (cb.id && document.querySelector(`label[for="${cb.id}"]`))
        || cb.closest('label') || cb.parentElement;
      (cbLabel || cb).click();
      await sleep(rand(300, 500));
      // Force React state update if click didn't register
      if (!cb.checked) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
        nativeSetter?.call(cb, true);
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(rand(200, 300));
      }
    }

    // Start date → click field, navigate calendar back 12 months, pick day 1
    setStatus('⟳ Setting start date…');
    const startDateField = [...document.querySelectorAll('input, button, div')]
      .find(el => isVisible(el) && /^start date$/i.test(el.placeholder || el.textContent?.trim()));
    if (startDateField) {
      startDateField.click();
      await sleep(rand(500, 700));
      // Navigate back 3-5 years (36-60 months) randomly
      const monthsBack = rand(36, 60);
      for (let m = 0; m < monthsBack; m++) {
        const prevArrow = [...document.querySelectorAll('button, div, span')]
          .find(el => isVisible(el) && (/^[<‹←]$/.test(el.textContent.trim()) || /prev|back|before/i.test(el.getAttribute('aria-label') || '')));
        if (!prevArrow) break;
        prevArrow.click();
        await sleep(rand(80, 130));
      }
      await sleep(rand(200, 350));
      // Click the first available day ("1")
      const day1 = [...document.querySelectorAll('button, td, div')]
        .find(el => isVisible(el) && el.textContent.trim() === '1' && !el.disabled);
      if (day1) { day1.click(); await sleep(rand(300, 500)); }
    }

    setStatus('⟳ Filling description…');
    const descEl = [...document.querySelectorAll('textarea')]
      .find(t => isVisible(t) && /job history|achievements/i.test(t.placeholder));
    if (descEl) { await humanType(descEl, exp.description.slice(0, 600)); await humanDelay(); }

    setStatus('⟳ Saving…');
    const saveBtn = [...document.querySelectorAll('button')]
      .find(el => /^add$/i.test(el.textContent.trim()) && isVisible(el));
    if (!saveBtn) throw new Error('"Add" button not found');
    saveBtn.click();
  });
  heading.after(btn);
}

// ── Profile: Skills ───────────────────────────────────────────────────────────

function injectSkills() {
  const heading = [...document.querySelectorAll('h1,h2,h3,h4')]
    .find(el => /skills and expertise/i.test(el.textContent.trim()));
  if (!heading || heading.dataset.faiSkillsDone) return;
  heading.dataset.faiSkillsDone = '1';

  const btn = makeBtn('◆ Add Skills', async (kw, setStatus) => {
    setStatus('⟳ Loading skill list…');
    const stored = await new Promise(r => chrome.storage.local.get(['faiSkills'], r));
    const skillPool = stored.faiSkills?.length > 0 ? stored.faiSkills : [];

    // Pre-filter by keyword words so AI gets relevant options, not alphabetical garbage
    const kwWords = kw.toLowerCase().split(/[\s,]+/).filter(w => w.length > 2);
    const relevant = skillPool.filter(s => kwWords.some(w => s.toLowerCase().includes(w)));
    const finalPool = relevant.length >= 10 ? relevant : skillPool;
    const skillPoolStr = finalPool.slice(0, 80).join(', ');

    setStatus('⟳ Generating skills…');
    const p = await getProfile();
    const ctx = [p.faiYears && `${p.faiYears} years experience`].filter(Boolean).join(', ');
    const prompt = skillPool.length > 0
      ? `Pick 6 skills for a Fiverr freelancer in: ${kw}${ctx ? ' (' + ctx + ')' : ''}.
Choose ONLY from this exact list (these are the real options in Fiverr's database):
${skillPoolStr}

Return ONLY a JSON array of exactly 6 strings, copied verbatim from the list above:
["...", "...", "...", "...", "...", "..."]
JSON array only.`
      : `List 6 specific Fiverr skill names for a freelancer in: ${kw}.
Short phrases (1-3 words). Return ONLY a JSON array:
["Python automation", "Algorithmic trading", "Trading bot", "Forex trading", "Bot development", "MT4 expert advisor"]
JSON array only.`;

    const skillRaw = await ask(`Niche: ${kw}`, prompt);
    let skillsToAdd = [];
    try { skillsToAdd = JSON.parse(skillRaw.match(/\[[\s\S]*\]/)?.[0]) || []; }
    catch { skillsToAdd = []; }
    skillsToAdd = skillsToAdd.filter(Boolean).slice(0, 6);
    if (!skillsToAdd.length) throw new Error('Could not generate skills — try again');

    const SKILL_INPUT_SEL = 'input[placeholder*="JavaScript" i], input[placeholder*="skill" i], input[placeholder*="expertise" i]';

    for (let i = 0; i < skillsToAdd.length; i++) {
      if (_faiStop) break;
      const skill = skillsToAdd[i];
      setStatus(`⟳ Adding skill ${i + 1}/${skillsToAdd.length}: ${skill}`);

      const addBtn = findNearbyBtn(heading, /add new/i);
      if (!addBtn) throw new Error('"Add new" not found');
      addBtn.click();

      const skillInput = await waitFor(SKILL_INPUT_SEL, 7000);
      if (!skillInput) throw new Error('Skills modal did not open');
      await sleep(rand(300, 500));

      // Type with full React-compatible events
      const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      skillInput.focus();
      ns ? ns.call(skillInput, '') : (skillInput.value = '');
      skillInput.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(60);
      let cur = '';
      for (const ch of skill) {
        skillInput.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
        cur += ch;
        ns ? ns.call(skillInput, cur) : (skillInput.value = cur);
        skillInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        skillInput.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ch, bubbles: true }));
        skillInput.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
        await sleep(rand(45, 80));
      }
      await sleep(rand(1200, 1500));

      // Options are <p> elements in dropdown below the input
      const inputRect = skillInput.getBoundingClientRect();
      const sl = skill.toLowerCase();
      const opts = [...document.querySelectorAll('p, li, [role="option"]')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          if (r.width < 20 || r.height < 4) return false;
          if (r.top < inputRect.bottom - 10) return false;
          const t = el.textContent.trim();
          return t.length > 0 && t.length < 100;
        });
      const chosen = opts.find(el => el.textContent.trim().toLowerCase() === sl)
        || opts.find(el => el.textContent.trim().toLowerCase().startsWith(sl))
        || opts.find(el => el.textContent.trim().toLowerCase().includes(sl))
        || opts[0];

      if (chosen) {
        chosen.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        chosen.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window }));
        chosen.click();
        await sleep(rand(400, 600));

        // Experience level — custom dropdown (Beginner / Intermediate / Pro), NOT a <select>
        const levelCandidates = [...document.querySelectorAll('div, button, span, [role="combobox"]')]
          .filter(el => isVisible(el) && /experience.?level/i.test(el.textContent.trim()) && el.textContent.trim().length < 60);
        const levelTrigger = levelCandidates.length
          ? levelCandidates.reduce((b, e) => e.textContent.trim().length < b.textContent.trim().length ? e : b)
          : null;
        if (levelTrigger) {
          levelTrigger.focus();
          levelTrigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          levelTrigger.click();
          await sleep(rand(400, 600));
          const proOpt = [...document.querySelectorAll('li, [role="option"], p, div')]
            .find(el => isVisible(el) && /^pro$/i.test(el.textContent.trim()));
          if (proOpt) { proOpt.click(); await sleep(rand(300, 500)); }
        }

        const saveBtn = [...document.querySelectorAll('button')]
          .find(el => /^add$/i.test(el.textContent.trim()) && isVisible(el) && !el.disabled);
        if (saveBtn) { saveBtn.click(); await sleep(rand(700, 1000)); }
      } else {
        // No results at all — cancel this skill and move on
        const cancelBtn = [...document.querySelectorAll('button')]
          .find(el => /cancel/i.test(el.textContent.trim()) && isVisible(el));
        if (cancelBtn) cancelBtn.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(rand(400, 600));
      }

      await waitGone(SKILL_INPUT_SEL, 5000);
      await sleep(rand(400, 700));
    }
  });
  heading.after(btn);
}

// ── Observe & inject ──────────────────────────────────────────────────────────

function scanAndInject() {
  if (!faiEnabled) return;
  if (GIG_PATTERN.test(location.href)) {
    injectPage1();
    injectPage2();
    injectPage3();
    injectPage4();
    injectPage5();
  }
  if (PROFILE_PATTERN.test(location.href)) {
    injectAbout();
    injectWorkExp();
    injectSkills();
  }
}

let debounce;
new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = setTimeout(scanAndInject, 600);
}).observe(document.body, { childList: true, subtree: true });

setTimeout(scanAndInject, 1000);
