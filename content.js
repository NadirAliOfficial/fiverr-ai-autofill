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

async function ask(prompt, system) {
  const res = await chrome.runtime.sendMessage({
    type: 'GROQ_REQUEST',
    payload: { apiKey, prompt, systemPrompt: system }
  });
  if (res.error) throw new Error(res.error);
  return res.result;
}

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
      const text = await ask(`Keywords: ${kw}`,
        `Write a short, SEO-optimized Fiverr gig title. The field already shows "I will" — write ONLY what comes after "I will". Do NOT include "I will".
Max 60 chars. Naturally include 1-2 of these keywords: ${kw}.
Start with a strong verb (build, develop, automate, design, create).
Be specific and punchy: service + tool/platform + outcome. No filler words.
Reply with ONLY the text, no quotes.`
      );
      const clean = text.replace(/^["']|["']$/g, '').trim().replace(/^i will\s+/i, '').trim();
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
      const raw = await ask(`Keywords: ${kw}`,
        `Create 3 Fiverr packages for a gig about: ${kw}. Return ONLY valid JSON:
{
  "basic":    { "name": "UNIQUE_NAME_1", "description": "...", "price": 30  },
  "standard": { "name": "UNIQUE_NAME_2", "description": "...", "price": 75  },
  "premium":  { "name": "UNIQUE_NAME_3", "description": "...", "price": 150 }
}
Rules:
- Names: creative tier-appropriate names (NOT Basic/Standard/Premium). E.g. Starter, Growth, Pro, Elite, Essential, Advanced, Ultimate. Each must be DIFFERENT.
- Description: exactly one sentence, 120-145 characters, SPECIFIC to ${kw}. State clearly what the buyer gets — tools used, scope, deliverable format. No filler phrases like "perfect for businesses".
- Prices: realistic for the gig type and tier (basic cheapest, premium highest).
- Escalate scope between tiers: basic = minimal, standard = full, premium = everything + extras.
JSON only.`
      );

      let pkgs;
      try { pkgs = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]); }
      catch { throw new Error('Could not parse packages — try again'); }
      if (!pkgs || !pkgs.basic) throw new Error('Invalid package data — try again');

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
        if (freshDescs[i]) { await humanType(freshDescs[i], pkg.description.trim().slice(0, 145)); await humanDelay(); }
        if (priceInputs[i]) { await humanType(priceInputs[i], String(pkg.price)); await humanDelay(); }
      }
      setMsg('Packages done — set Delivery Time manually', 'success');
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
      const data = await ask(`Keywords: ${kw}`,
        `Write a Fiverr gig description for: ${kw}. Return ONLY valid JSON with these exact keys:
{
  "hook": "Opening paragraph: 2-3 sentences on value and outcome. ~180 chars.",
  "bullets": ["deliverable 1", "deliverable 2", "deliverable 3", "deliverable 4", "deliverable 5", "deliverable 6"],
  "why": "Why choose me paragraph: 2-3 sentences on experience, quality, speed, support. ~180 chars.",
  "cta": "Single call-to-action sentence. ~70 chars."
}
Rules:
- Each bullet is a SHORT specific deliverable (no emoji, 8-12 words max)
- Weave keywords naturally: ${kw}
- Total hook+bullets+why+cta must be ~900 characters including spaces
- Output JSON only — no extra text, no char counts, no explanations`
      );

      let desc;
      try { desc = JSON.parse(data.match(/\{[\s\S]*\}/)?.[0]); }
      catch { throw new Error('Could not parse description — try again'); }
      if (!desc?.hook || !Array.isArray(desc.bullets)) throw new Error('Bad description format — try again');
      // Sanitise: ensure bullets are plain strings, strip any char-count notes AI may have added
      desc.bullets = desc.bullets.map(b => String(b).replace(/\s*\(\d+.*?\)\s*$/, '').trim()).filter(Boolean).slice(0, 6);
      desc.hook = String(desc.hook).replace(/\s*\(\d+.*?\)\s*/g, '').trim();
      desc.why  = String(desc.why).replace(/\s*\(\d+.*?\)\s*/g, '').trim();
      desc.cta  = String(desc.cta).replace(/\s*\(\d+.*?\)\s*/g, '').trim();

      editor.click();
      editor.focus();
      await sleep(rand(200, 350));

      // Helpers that use Quill toolbar buttons (more reliable than execCommand)
      const qlBold   = () => document.querySelector('.ql-bold');
      const qlBullet = () => document.querySelector('.ql-list[value="bullet"]');
      const insert   = (text) => { editor.focus(); document.execCommand('insertText', false, text); };
      const newLine  = () => document.execCommand('insertParagraph', false, null);

      // Clear editor
      document.execCommand('selectAll', false, null);
      await sleep(60);
      document.execCommand('delete', false, null);
      await sleep(100);

      // Hook paragraph
      insert(desc.hook);
      newLine(); newLine();
      await sleep(rand(80, 130));

      // "What You Get:" — bold via toolbar click
      qlBold()?.click(); await sleep(60);
      insert('What You Get:');
      qlBold()?.click(); await sleep(60);
      newLine();

      // Bullet list via toolbar click
      qlBullet()?.click(); await sleep(100);
      for (let bi = 0; bi < desc.bullets.length; bi++) {
        insert(desc.bullets[bi]);
        await sleep(rand(40, 70));
        // Only add newline between items — not after the last one
        if (bi < desc.bullets.length - 1) { newLine(); await sleep(rand(30, 60)); }
      }
      // Exit list: click bullet to toggle off (cursor is at end of last item, not on empty line)
      qlBullet()?.click(); await sleep(80);
      newLine(); newLine();

      // "Why Choose Me:" — bold via toolbar click
      qlBold()?.click(); await sleep(60);
      insert('Why Choose Me:');
      qlBold()?.click(); await sleep(60);
      newLine();
      insert(desc.why);
      newLine(); newLine();
      await sleep(rand(60, 100));

      // CTA
      insert(desc.cta);
      await sleep(rand(80, 140));

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
      const raw = await ask(`Keywords: ${kw}`,
        `Write exactly 5 UNIQUE FAQs for a Fiverr gig about: ${kw}
Questions and answers must be SPECIFIC to this gig type — not generic.
Cover these 5 topics in order:
1. Delivery time — how long does the work take? Be specific (e.g. "3-5 business days depending on complexity").
2. Revisions — how many revisions are included and what counts as a revision?
3. Requirements — what information or assets do you need from the buyer to start?
4. Output/deliverables — exactly what files, formats, or results will the buyer receive?
5. Experience — what is your background or expertise relevant to this gig?
Return ONLY valid JSON array:
[
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." }
]
STRICT RULES:
- NEVER mention email, phone, WhatsApp, Telegram, Skype or any outside contact — Fiverr TOS violation.
- Questions: natural, conversational, phrased as buyer asking seller.
- Answers: 2-3 sentences, SPECIFIC to ${kw}, use 220-260 characters. Include real details — tools, timelines, formats, numbers. No vague filler like "it depends" or "great results".
- Weave keywords from (${kw}) naturally into 2-3 answers.
JSON only, no markdown.`
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
    const companyStr = companyList.slice(0, 60).join(', ');

    setStatus('⟳ Generating entry…');
    const p = await getProfile();
    const ctx = [p.faiName && `Name: ${p.faiName}`, p.faiYears && `${p.faiYears} years experience`, p.faiCountry && `Based in ${p.faiCountry}`].filter(Boolean).join(', ');
    const raw = await ask(`Niche: ${kw}`,
      `Create one realistic freelance work experience entry for a Fiverr seller in: ${kw}.${ctx ? '\nFreelancer: ' + ctx + '.' : ''}
Niche: ${kw}
Return ONLY valid JSON:
{
  "title": "Job title (e.g. Algorithmic Trading Bot Developer)",
  "company": "Pick the single best match from this exact list: ${companyStr}",
  "currentlyWorking": true,
  "description": "Specific achievements, tools used, results. Max 600 chars. No markdown."
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
    if (exp.currentlyWorking) {
      const cb = [...document.querySelectorAll('input[type="checkbox"]')].find(c => isVisible(c));
      if (cb && !cb.checked) { cb.click(); await sleep(rand(150, 280)); }
    }

    // Start date → click field, navigate calendar back 12 months, pick day 1
    setStatus('⟳ Setting start date…');
    const startDateField = [...document.querySelectorAll('input, button, div')]
      .find(el => isVisible(el) && /^start date$/i.test(el.placeholder || el.textContent?.trim()));
    if (startDateField) {
      startDateField.click();
      await sleep(rand(500, 700));
      // Navigate back ~12 months using the prev-month arrow
      for (let m = 0; m < 12; m++) {
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
