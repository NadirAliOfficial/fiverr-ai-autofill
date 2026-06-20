const GIG_PATTERN = /fiverr\.com\/users\/[^/]+\/manage_gigs/;

let apiKey = '';
chrome.storage.sync.get(['groqApiKey'], ({ groqApiKey }) => { apiKey = groqApiKey || ''; });
chrome.storage.onChanged.addListener(c => { if (c.groqApiKey) apiKey = c.groqApiKey.newValue || ''; });

// ── Anti-detection helpers ────────────────────────────────────────────────────

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function humanDelay() { return sleep(rand(400, 900)); }   // pause between fields

// Human-like typing: char by char with random delays, no instant value injection
async function humanType(el, text) {
  el.focus();
  await sleep(rand(80, 200));

  // Clear existing value via native setter first (keyboard events alone don't clear React state)
  const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  nativeSetter ? nativeSetter.call(el, '') : (el.value = '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(rand(60, 140));

  let current = '';
  for (const char of text) {
    current += char;
    nativeSetter ? nativeSetter.call(el, current) : (el.value = current);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(rand(18, 55));    // typing speed variation
    if (Math.random() < 0.05) await sleep(rand(150, 400)); // occasional pause
  }

  el.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(rand(60, 140));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  await sleep(rand(100, 250));
}

// For Quill/contenteditable rich editors
async function humanTypeRich(el, text) {
  el.focus();
  await sleep(rand(100, 250));
  el.innerHTML = text.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(rand(200, 400));
}

async function typeTag(input, tag) {
  await humanType(input, tag);
  await sleep(rand(150, 300));
  ['keydown', 'keypress', 'keyup'].forEach(e =>
    input.dispatchEvent(new KeyboardEvent(e, { key: 'Enter', keyCode: 13, which: 13, bubbles: true }))
  );
  await sleep(rand(250, 500));
  if (input.value.trim()) {
    ['keydown', 'keypress', 'keyup'].forEach(e =>
      input.dispatchEvent(new KeyboardEvent(e, { key: ',', keyCode: 188, which: 188, bubbles: true }))
    );
    const proto = HTMLInputElement.prototype;
    const ns = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    ns ? ns.call(input, '') : (input.value = '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(rand(200, 400));
  }
}

function getCurrentTab() {
  return new URL(location.href).searchParams.get('tab') || 'general';
}

function setMsg(text, type = 'info') {
  const el = document.getElementById('fai-msg');
  if (el) { el.textContent = text; el.className = `fai-msg-${type}`; }
}

function setLoading(on) {
  const btn = document.getElementById('fai-fill-all');
  const spinner = document.getElementById('fai-spinner');
  if (btn) btn.disabled = on;
  if (spinner) spinner.style.display = on ? 'inline-block' : 'none';
  document.querySelectorAll('.fai-field-btn').forEach(b => b.disabled = on);
}

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
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

// ── Groq ──────────────────────────────────────────────────────────────────────

async function ask(prompt, system) {
  const res = await chrome.runtime.sendMessage({
    type: 'GROQ_REQUEST',
    payload: { apiKey, prompt, systemPrompt: system }
  });
  if (res.error) throw new Error(res.error);
  return res.result;
}

// ── Page 1: Overview (tab=general) ───────────────────────────────────────────

const PAGE1 = {
  titleInput() {
    return (
      document.querySelector('textarea[placeholder*="I will"]') ||
      document.querySelector('input[placeholder*="I will"]') ||
      document.querySelector('textarea[maxlength="80"]') ||
      document.querySelector('input[maxlength="80"]')
    );
  },

  tagInput() {
    return (
      findByNearbyText('input', /positive keywords/i) ||
      findByNearbyText('input', /5 tags maximum/i) ||
      document.querySelector('input[placeholder*="positive" i]') ||
      document.querySelector('input[placeholder*="tag" i]')
    );
  },

  async fillTitle(kw) {
    const el = this.titleInput();
    if (!el) throw new Error('Title field not found — are you on the Overview tab?');
    setMsg('Generating title…', 'info');
    const text = await ask(
      `Keywords: ${kw}`,
      `You are a top-rated Fiverr seller writing a gig title.
The field already has "I will" shown — write ONLY what comes AFTER "I will". Do NOT include "I will".
Rules:
- Max 73 characters
- Start with a strong action verb (build, develop, automate, design, create, code)
- Specific: include main service + tool/platform/language + outcome
- No filler words like "provide", "offer", "give you", "help you"
Bad example: create a trading bot
Good example: build a professional IBKR algorithmic trading bot using Python
Reply with ONLY the text after "I will", no quotes, nothing else.`
    );
    const clean = text.replace(/^["']|["']$/g, '').trim().replace(/^i will\s+/i, '').trim();
    await humanType(el, clean.slice(0, 73));
  },

  async fillTags(kw) {
    const input = this.tagInput();
    if (!input) throw new Error('Tag input not found — scroll down to Search tags section');
    setMsg('Adding tags…', 'info');
    const raw = await ask(
      `Keywords: ${kw}`,
      `Generate exactly 5 Fiverr search tags for this gig.
Rules: lowercase only, 1-3 words each, letters and numbers only (no special chars), no duplicates.
Return ONLY a comma-separated list of 5 tags, nothing else.
Example: algo trading, mt5 bot, python trading, expert advisor, automated trading`
    );
    const tags = raw.split(',').map(t => t.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '')).filter(Boolean).slice(0, 5);
    for (const tag of tags) {
      await typeTag(input, tag);
      await humanDelay();
    }
  },

  async fillAll(kw) {
    await this.fillTitle(kw);
    await humanDelay();
    await this.fillTags(kw);
    setMsg('Page 1 done — select Category manually, then Save & Continue', 'success');
  }
};

// ── Page 2: Scope & Pricing (tab=pricing) ────────────────────────────────────

const PAGE2 = {
  // Returns [basic, standard, premium] textareas for a given placeholder
  packageFields(placeholder) {
    return [...document.querySelectorAll(`textarea[placeholder*="${placeholder}"]`)].slice(0, 3);
  },

  priceInputs() {
    // Price row: inputs near a "$" label
    const allInputs = [...document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')];
    // Filter: visible, numeric-looking, no placeholder or numeric placeholder
    return allInputs.filter(el => {
      if (!isVisible(el)) return false;
      const ph = (el.placeholder || '').toLowerCase();
      const prev = el.previousElementSibling?.textContent?.trim();
      const parent = el.parentElement?.textContent?.trim();
      return (
        parent?.includes('$') ||
        prev === '$' ||
        ph.includes('price') ||
        el.type === 'number'
      );
    }).slice(0, 3);
  },

  async fillAll(kw) {
    setMsg('Generating packages…', 'info');
    const raw = await ask(
      `Keywords: ${kw}`,
      `You are a top-rated Fiverr seller. Create 3 pricing packages. Return ONLY valid JSON:
{
  "basic":    { "name": "Basic",    "description": "...", "price": 30  },
  "standard": { "name": "Standard", "description": "...", "price": 75  },
  "premium":  { "name": "Premium",  "description": "...", "price": 150 }
}
Description rules:
- AIM for 65-90 characters — not less, not more than 99
- One sentence, mention what is included (features, support level, scope)
- Be specific to the gig, not generic
- Example (85 chars): "Basic IBKR bot setup with entry/exit logic, backtesting, and email support included"
Prices must be realistic for: ${kw}. No markdown, no explanation, only the JSON object.`
    );

    let pkgs;
    try {
      pkgs = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]);
    } catch { throw new Error('Could not parse package data — try again'); }

    const tiers = ['basic', 'standard', 'premium'];
    const nameFields = this.packageFields('Name your package');
    const descFields = this.packageFields('Describe the details');
    const priceFields = this.priceInputs();

    for (let i = 0; i < 3; i++) {
      const pkg = pkgs[tiers[i]];
      if (!pkg) continue;

      if (nameFields[i]) {
        setMsg(`Filling ${tiers[i]} package…`, 'info');
        await humanType(nameFields[i], pkg.name);
        await humanDelay();
      }
      if (descFields[i]) {
        const desc = pkg.description.trim().slice(0, 99);
        await humanType(descFields[i], desc);
        await humanDelay();
      }
      if (priceFields[i]) {
        await humanType(priceFields[i], String(pkg.price));
        await humanDelay();
      }
    }

    setMsg('Packages filled — set Delivery Time manually, then Save & Continue', 'success');
  }
};

// ── Page 3: Description & FAQ (tab=description) ───────────────────────────────

const PAGE3 = {
  descEditor() {
    return document.querySelector('.ql-editor[contenteditable="true"]');
  },

  addFaqBtn() {
    return [...document.querySelectorAll('a, button, span')].find(el =>
      /^\+?\s*Add FAQ$/i.test(el.textContent.trim())
    );
  },

  async fillDescription(kw) {
    const el = this.descEditor();
    if (!el) throw new Error('Description editor not found — are you on the Description & FAQ tab?');
    setMsg('Generating description…', 'info');
    const text = await ask(
      `Keywords: ${kw}`,
      `You are a top-rated Fiverr seller. Write a professional gig description (max 1100 characters).
Structure:
- Opening hook: 1-2 sentences on the value you deliver
- What's included: 4-6 bullet points starting with ✅
- Why choose me: 2-3 short sentences (experience, quality, support)
- Call to action: 1 sentence
Use plain text only. No markdown headers. Keep total under 1100 characters.`
    );
    await humanTypeRich(el, text.slice(0, 1100));
  },

  async fillFAQs(kw) {
    setMsg('Generating FAQs…', 'info');
    const raw = await ask(
      `Keywords: ${kw}`,
      `Write 4 FAQ entries for a Fiverr gig. Return ONLY a valid JSON array:
[
  { "question": "short question?", "answer": "1-2 sentence answer" },
  { "question": "short question?", "answer": "1-2 sentence answer" },
  { "question": "short question?", "answer": "1-2 sentence answer" },
  { "question": "short question?", "answer": "1-2 sentence answer" }
]
Cover: revisions policy, delivery time, tech stack used, communication/support. JSON only.`
    );

    let faqs;
    try {
      faqs = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0]);
    } catch { throw new Error('Could not parse FAQs — try again'); }

    for (let i = 0; i < faqs.length; i++) {
      const faq = faqs[i];

      // Click "+ Add FAQ" to reveal a new row
      const addBtn = this.addFaqBtn();
      if (!addBtn) { setMsg(`Only ${i} FAQs added — "+ Add FAQ" not found`, 'error'); break; }
      addBtn.click();
      await sleep(rand(600, 1000));

      // Grab the last question/answer pair that appeared
      const qInputs = [...document.querySelectorAll('input[placeholder*="question" i], input[placeholder*="Question"]')];
      const aInputs = [...document.querySelectorAll('textarea[placeholder*="answer" i], textarea[placeholder*="Answer"]')];
      const qEl = qInputs[qInputs.length - 1];
      const aEl = aInputs[aInputs.length - 1];

      if (qEl) { await humanType(qEl, faq.question); await humanDelay(); }
      if (aEl) { await humanType(aEl, faq.answer);   await humanDelay(); }
    }
  },

  async fillAll(kw) {
    await this.fillDescription(kw);
    await humanDelay();
    await this.fillFAQs(kw);
    setMsg('Page 3 done — review and Save & Continue', 'success');
  }
};

// ── Bar & Buttons ─────────────────────────────────────────────────────────────

function injectBar() {
  if (document.getElementById('fai-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'fai-bar';
  bar.innerHTML = `
    <span class="fai-logo">⚡ AI Fill</span>
    <input id="fai-keywords" type="text" placeholder="Keywords: algo trading, mt5, python…" autocomplete="off" />
    <button id="fai-fill-all">Fill All</button>
    <div id="fai-spinner"></div>
    <span id="fai-msg"></span>
  `;
  document.body.prepend(bar);
  document.getElementById('fai-fill-all').addEventListener('click', runFillAll);
  setTimeout(injectFieldButtons, 1000);
}

function injectFieldButtons() {
  const tab = getCurrentTab();

  if (tab === 'general') {
    injectBtn(PAGE1.titleInput(), '⚡ Title', async (kw) => {
      await PAGE1.fillTitle(kw);
      setMsg('Title filled!', 'success');
    });
    injectBtn(PAGE1.tagInput(), '⚡ Tags', async (kw) => {
      await PAGE1.fillTags(kw);
      setMsg('Tags added!', 'success');
    });
  }

  if (tab === 'pricing') {
    const nameFields = PAGE2.packageFields('Name your package');
    nameFields.forEach((el, i) => {
      const labels = ['Basic name', 'Standard name', 'Premium name'];
      injectBtn(el, `⚡ ${labels[i]}`, async (kw) => {
        const raw = await ask(`Keywords: ${kw}, tier: ${labels[i]}`,
          `Write a short Fiverr package name (2-4 words) for the ${labels[i].split(' ')[0]} tier. Only the name, nothing else.`);
        await humanType(el, raw.trim());
        setMsg('Done', 'success');
      });
    });
  }

  if (tab === 'description') {
    const editor = PAGE3.descEditor();
    if (editor && !editor.dataset.faiBtnDone) {
      editor.dataset.faiBtnDone = '1';
      const btn = document.createElement('button');
      btn.className = 'fai-field-btn';
      btn.textContent = '⚡ Description';
      btn.style.marginBottom = '8px';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const kw = getKeywords();
        if (!kw) { setMsg('Enter keywords first', 'error'); return; }
        btn.disabled = true; btn.textContent = '…';
        try {
          await PAGE3.fillDescription(kw);
          setMsg('Description filled!', 'success');
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '⚡ Description'; btn.disabled = false; }, 2000);
        } catch(err) { setMsg(err.message, 'error'); btn.textContent = '⚡ Description'; btn.disabled = false; }
      });
      editor.closest('.ql-container')?.parentElement?.prepend(btn);
    }
  }
}

function injectBtn(el, label, onClickFn) {
  if (!el || el.dataset.faiBtnDone) return;
  el.dataset.faiBtnDone = '1';
  const btn = document.createElement('button');
  btn.className = 'fai-field-btn';
  btn.textContent = label;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const kw = getKeywords();
    if (!kw) { setMsg('Enter keywords first', 'error'); return; }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = '…';
    try {
      await onClickFn(kw);
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    } catch (err) {
      setMsg(err.message, 'error');
      btn.textContent = orig;
      btn.disabled = false;
    }
  });
  (el.closest('div') || el.parentElement)?.appendChild(btn);
}

function getKeywords() {
  return (document.getElementById('fai-keywords')?.value || '').trim();
}

async function runFillAll() {
  const kw = getKeywords();
  if (!kw) return setMsg('Enter keywords first', 'error');
  setLoading(true);
  try {
    const tab = getCurrentTab();
    if (tab === 'general')     await PAGE1.fillAll(kw);
    else if (tab === 'pricing')     await PAGE2.fillAll(kw);
    else if (tab === 'description') await PAGE3.fillAll(kw);
    else setMsg(`Send screenshot of this tab and I'll add support`, 'info');
  } catch (e) {
    setMsg(e.message, 'error');
  } finally {
    setLoading(false);
  }
}

// ── Init & SPA watch ─────────────────────────────────────────────────────────

function init() {
  if (GIG_PATTERN.test(location.href)) setTimeout(injectBar, 900);
}

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (GIG_PATTERN.test(location.href)) {
      document.getElementById('fai-bar')?.remove();
      setTimeout(() => { injectBar(); }, 1000);
    } else {
      document.getElementById('fai-bar')?.remove();
    }
  }
}).observe(document.body, { childList: true, subtree: true });

init();
