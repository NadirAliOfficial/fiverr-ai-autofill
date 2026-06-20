const GIG_PATTERN = /fiverr\.com\/users\/[^/]+\/manage_gigs/;

let apiKey = '';
chrome.storage.sync.get(['groqApiKey'], ({ groqApiKey }) => { apiKey = groqApiKey || ''; });
chrome.storage.onChanged.addListener(c => { if (c.groqApiKey) apiKey = c.groqApiKey.newValue || ''; });

// ── Anti-detection ────────────────────────────────────────────────────────────

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
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
  return (document.getElementById('fai-keywords')?.value || '').trim();
}

function setMsg(text, type = 'info') {
  const el = document.getElementById('fai-msg');
  if (el) { el.textContent = text; el.className = `fai-msg-${type}`; }
}

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
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const kw = getKeywords();
    if (!kw) { setMsg('Enter keywords in the bar first', 'error'); return; }
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await onClick(kw);
      btn.textContent = '✓ Done';
      setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 2500);
    } catch (err) {
      setMsg(err.message, 'error');
      btn.textContent = label;
      btn.disabled = false;
    }
  });
  return btn;
}

// ── Page 1: Overview ──────────────────────────────────────────────────────────

function injectPage1() {
  // Title
  const titleEl = (
    document.querySelector('textarea[placeholder*="I will"]') ||
    document.querySelector('input[placeholder*="I will"]') ||
    document.querySelector('textarea[maxlength="80"]') ||
    document.querySelector('input[maxlength="80"]')
  );
  if (titleEl && !titleEl.dataset.faiDone) {
    titleEl.dataset.faiDone = '1';
    const btn = makeBtn('⚡ Generate Title', async (kw) => {
      setMsg('Generating title…', 'info');
      const text = await ask(`Keywords: ${kw}`,
        `Write a Fiverr gig title. The field already shows "I will" — write ONLY what comes after "I will". Do NOT include "I will".
Max 73 chars. Start with a strong verb (build, develop, automate, design, create).
Be specific: include service + tool/platform + outcome. No filler words.
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
    const btn = makeBtn('⚡ Generate Tags', async (kw) => {
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
  const nameFields = [...document.querySelectorAll('textarea[placeholder*="Name your package"]')].slice(0, 3);
  const descFields = [...document.querySelectorAll('textarea[placeholder*="Describe the details"]')].slice(0, 3);

  if (!nameFields.length) return;

  // One "Fill Packages" button above the table
  const anchor = nameFields[0].closest('table, div[class*="package"], section') || nameFields[0].closest('div');
  if (anchor && !anchor.dataset.faiDone) {
    anchor.dataset.faiDone = '1';
    const btn = makeBtn('⚡ Generate All Packages', async (kw) => {
      setMsg('Generating packages…', 'info');
      const raw = await ask(`Keywords: ${kw}`,
        `Create 3 Fiverr packages. Return ONLY valid JSON:
{
  "basic":    { "name": "Basic",    "description": "65-90 chars, one sentence, key deliverable", "price": 30  },
  "standard": { "name": "Standard", "description": "65-90 chars, one sentence, key deliverable", "price": 75  },
  "premium":  { "name": "Premium",  "description": "65-90 chars, one sentence, key deliverable", "price": 150 }
}
Description: 65-90 characters, specific, mentions what is included. Prices realistic for: ${kw}.`
      );
      let pkgs;
      try { pkgs = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]); }
      catch { throw new Error('Could not parse packages — try again'); }

      const tiers = ['basic', 'standard', 'premium'];
      const priceInputs = [...document.querySelectorAll('input[type="number"], input[type="text"]')]
        .filter(el => el.closest('td, [class*="price"]') && isVisible(el)).slice(0, 3);

      for (let i = 0; i < 3; i++) {
        const pkg = pkgs[tiers[i]];
        if (!pkg) continue;
        setMsg(`Filling ${tiers[i]}…`, 'info');
        if (nameFields[i]) { await humanType(nameFields[i], pkg.name); await humanDelay(); }
        if (descFields[i]) { await humanType(descFields[i], pkg.description.trim().slice(0, 99)); await humanDelay(); }
        if (priceInputs[i]) { await humanType(priceInputs[i], String(pkg.price)); await humanDelay(); }
      }
      setMsg('Packages done — set Delivery Time manually', 'success');
    });
    anchor.before(btn);
  }
}

// ── Page 3: Description & FAQ ─────────────────────────────────────────────────

function injectPage3() {
  // ── Description ──
  const editor = document.querySelector('.ql-editor[contenteditable="true"]');
  const toolbar = document.querySelector('.ql-toolbar');

  if (editor && toolbar && !toolbar.dataset.faiDone) {
    toolbar.dataset.faiDone = '1';
    const btn = makeBtn('⚡ Generate Description', async (kw) => {
      setMsg('Generating description…', 'info');
      const data = await ask(`Keywords: ${kw}`,
        `Write a professional Fiverr gig description. Return ONLY valid JSON:
{
  "hook": "2-3 sentence opening about the value and outcome you deliver (150-200 chars)",
  "bullets": [
    "specific deliverable 1 (no emoji, plain text)",
    "specific deliverable 2",
    "specific deliverable 3",
    "specific deliverable 4",
    "specific deliverable 5",
    "specific deliverable 6"
  ],
  "why": "3 sentences about experience, quality, fast delivery, support (200-250 chars)",
  "cta": "One strong sentence asking them to message you now"
}
Be specific to: ${kw}. JSON only, no markdown.`
      );

      let desc;
      try { desc = JSON.parse(data.match(/\{[\s\S]*\}/)?.[0]); }
      catch { throw new Error('Could not parse description — try again'); }

      editor.click();
      editor.focus();
      await sleep(rand(200, 350));

      // Clear
      document.execCommand('selectAll', false, null);
      await sleep(rand(60, 100));
      document.execCommand('delete', false, null);
      await sleep(rand(80, 150));

      // Hook (plain paragraph)
      document.execCommand('insertText', false, desc.hook);
      await sleep(rand(80, 140));
      document.execCommand('insertParagraph', false, null);
      document.execCommand('insertParagraph', false, null);
      await sleep(rand(60, 100));

      // "What You Get:" in bold
      document.execCommand('bold', false, null);
      document.execCommand('insertText', false, 'What You Get:');
      document.execCommand('bold', false, null);
      document.execCommand('insertParagraph', false, null);
      await sleep(rand(60, 100));

      // Bullet list
      document.execCommand('insertUnorderedList', false, null);
      await sleep(rand(60, 100));
      for (const bullet of desc.bullets) {
        document.execCommand('insertText', false, bullet);
        await sleep(rand(40, 80));
        document.execCommand('insertParagraph', false, null);
        await sleep(rand(40, 80));
      }
      // Exit list
      document.execCommand('insertUnorderedList', false, null);
      await sleep(rand(60, 100));
      document.execCommand('insertParagraph', false, null);

      // "Why Choose Me:" in bold
      document.execCommand('bold', false, null);
      document.execCommand('insertText', false, 'Why Choose Me:');
      document.execCommand('bold', false, null);
      document.execCommand('insertParagraph', false, null);
      document.execCommand('insertText', false, desc.why);
      document.execCommand('insertParagraph', false, null);
      document.execCommand('insertParagraph', false, null);
      await sleep(rand(60, 100));

      // CTA
      document.execCommand('insertText', false, desc.cta);
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
    const btn = makeBtn('⚡ Generate FAQs', async (kw) => {
      setMsg('Generating FAQs…', 'info');
      const raw = await ask(`Keywords: ${kw}`,
        `Write exactly 5 UNIQUE FAQs for a Fiverr gig about: ${kw}
Each question must cover a DIFFERENT topic. Use this exact topic order:
1. Delivery time — how long does it take?
2. Revisions — how many revisions are included?
3. Tech stack — what tools/languages/platforms do you use?
4. Source files — will they get source code or editable files?
5. Communication — how do you keep the client updated?
Return ONLY valid JSON array, no duplicates, no same question twice:
[
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." }
]
Each answer under 265 characters, specific to the gig. JSON only.`
      );
      let faqs;
      try { faqs = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0]); }
      catch { throw new Error('Could not parse FAQs — try again'); }

      for (let i = 0; i < Math.min(faqs.length, 5); i++) {
        setMsg(`Adding FAQ ${i + 1}/4…`, 'info');

        // If no input is visible, click "+ Add FAQ" to open the form
        let qEl = document.querySelector('input[placeholder*="Add a Question" i]');
        if (!qEl) {
          const addBtn = [...document.querySelectorAll('a, button, span, p')]
            .find(el => /add faq/i.test(el.textContent.trim()));
          if (!addBtn) { setMsg(`FAQ form not found after ${i} entries`, 'error'); break; }
          addBtn.click();
          await sleep(rand(700, 1000));
          qEl = document.querySelector('input[placeholder*="Add a Question" i]');
        }

        const aEl = document.querySelector('textarea[placeholder*="Add an Answer" i]');
        if (!qEl || !aEl) { setMsg(`FAQ inputs not found at entry ${i + 1}`, 'error'); break; }

        // Fill question and answer
        await humanType(qEl, faqs[i].question);
        await humanDelay();
        await humanType(aEl, faqs[i].answer.slice(0, 295));
        await humanDelay();

        // Click the "Add" button to save this FAQ
        const saveBtn = [...document.querySelectorAll('button')]
          .find(el => el.textContent.trim() === 'Add' && isVisible(el));
        if (!saveBtn) { setMsg(`"Add" button not found at FAQ ${i + 1}`, 'error'); break; }
        saveBtn.click();
        await sleep(rand(800, 1200));
      }
      setMsg('FAQs done!', 'success');
    });
    faqHeading.after(btn);
  }
}

// ── Top bar ───────────────────────────────────────────────────────────────────

function injectBar() {
  if (document.getElementById('fai-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'fai-bar';
  bar.innerHTML = `
    <span class="fai-logo">⚡ AI Fill</span>
    <input id="fai-keywords" type="text" placeholder="Keywords: algo trading, mt5, python…" autocomplete="off" />
    <span id="fai-msg"></span>
  `;
  document.body.prepend(bar);
}

// ── Observe & inject ──────────────────────────────────────────────────────────

function scanAndInject() {
  if (!GIG_PATTERN.test(location.href)) return;
  injectBar();
  injectPage1();
  injectPage2();
  injectPage3();
}

let debounce;
new MutationObserver(() => {
  clearTimeout(debounce);
  debounce = setTimeout(scanAndInject, 600);
}).observe(document.body, { childList: true, subtree: true });

setTimeout(scanAndInject, 1000);
