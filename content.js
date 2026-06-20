const GIG_URL_PATTERN = /fiverr\.com\/(new-gig|users\/[^/]+\/manage_gigs)/;

let panel = null;
let apiKey = '';

chrome.storage.sync.get(['groqApiKey'], ({ groqApiKey }) => {
  apiKey = groqApiKey || '';
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.groqApiKey) apiKey = changes.groqApiKey.newValue || '';
});

function isGigPage() {
  return GIG_URL_PATTERN.test(location.href);
}

function injectPanel() {
  if (document.getElementById('fai-panel')) return;

  panel = document.createElement('div');
  panel.id = 'fai-panel';
  panel.innerHTML = `
    <div id="fai-header">
      <span id="fai-title">⚡ Gig AI Fill</span>
      <button id="fai-toggle">−</button>
    </div>
    <div id="fai-body">
      <textarea id="fai-topic" placeholder="Describe your gig (e.g. I will design a professional logo for your brand using Illustrator)"></textarea>
      <div id="fai-buttons">
        <button class="fai-btn" data-action="title">📝 Title</button>
        <button class="fai-btn" data-action="description">📄 Description</button>
        <button class="fai-btn" data-action="packages">📦 Packages</button>
        <button class="fai-btn" data-action="faqs">❓ FAQs</button>
        <button class="fai-btn fai-btn-all" data-action="all">✨ Fill All</button>
      </div>
      <div id="fai-status"></div>
    </div>
  `;

  document.body.appendChild(panel);

  document.getElementById('fai-toggle').addEventListener('click', togglePanel);
  panel.querySelectorAll('.fai-btn').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn.dataset.action));
  });

  makeDraggable(panel);
}

function togglePanel() {
  const body = document.getElementById('fai-body');
  const btn = document.getElementById('fai-toggle');
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? 'flex' : 'none';
  btn.textContent = collapsed ? '−' : '+';
}

function setStatus(msg, type = 'info') {
  const el = document.getElementById('fai-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `fai-status-${type}`;
}

function setLoading(loading) {
  panel.querySelectorAll('.fai-btn').forEach(btn => btn.disabled = loading);
  if (loading) setStatus('Generating...', 'loading');
}

async function callGroq(prompt, systemPrompt) {
  if (!apiKey) {
    setStatus('Set your Groq API key in the extension popup.', 'error');
    return null;
  }
  const res = await chrome.runtime.sendMessage({
    type: 'GROQ_REQUEST',
    payload: { apiKey, prompt, systemPrompt }
  });
  if (res.error) throw new Error(res.error);
  return res.result;
}

async function handleAction(action) {
  const topic = document.getElementById('fai-topic').value.trim();
  if (!topic) {
    setStatus('Enter your gig description first.', 'error');
    return;
  }

  setLoading(true);
  try {
    if (action === 'all') {
      await fillTitle(topic);
      await fillDescription(topic);
      await fillPackages(topic);
      await fillFAQs(topic);
      setStatus('All fields filled!', 'success');
    } else if (action === 'title') {
      await fillTitle(topic);
      setStatus('Title filled!', 'success');
    } else if (action === 'description') {
      await fillDescription(topic);
      setStatus('Description filled!', 'success');
    } else if (action === 'packages') {
      await fillPackages(topic);
      setStatus('Packages filled!', 'success');
    } else if (action === 'faqs') {
      await fillFAQs(topic);
      setStatus('FAQs filled!', 'success');
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
  } finally {
    setLoading(false);
  }
}

// ─── Field Fillers ────────────────────────────────────────────────────────────

async function fillTitle(topic) {
  const text = await callGroq(
    `Gig: ${topic}`,
    `You are a top-rated Fiverr seller. Write ONE compelling Fiverr gig title (max 80 chars).
Start with "I will". Be specific, clear, and use strong action words.
Reply with ONLY the title, nothing else.`
  );
  if (!text) return;

  const input = findTitleInput();
  if (input) {
    setNativeValue(input, text.replace(/^["']|["']$/g, '').trim());
  } else {
    setStatus('Title field not found — are you on the Overview tab?', 'error');
  }
}

async function fillDescription(topic) {
  const text = await callGroq(
    `Gig: ${topic}`,
    `You are a top-rated Fiverr seller. Write a professional Fiverr gig description.
Structure:
- Opening hook (1-2 sentences about the value you deliver)
- What you offer (bullet points with ✅)
- Why choose me (2-3 points)
- Clear call to action
Keep it between 200-400 words. Use plain text, no markdown headers.`
  );
  if (!text) return;

  const filled = fillQuillEditor(text);
  if (!filled) {
    const textarea = findDescriptionTextarea();
    if (textarea) setNativeValue(textarea, text);
    else setStatus('Description field not found — open the Description & FAQ tab.', 'error');
  }
}

async function fillPackages(topic) {
  const text = await callGroq(
    `Gig: ${topic}`,
    `You are a top-rated Fiverr seller. Create 3 pricing packages for this gig.
Return ONLY valid JSON in this exact format:
{
  "basic": { "name": "Basic", "description": "...", "price": 15, "delivery": 3, "revisions": 1 },
  "standard": { "name": "Standard", "description": "...", "price": 35, "delivery": 5, "revisions": 3 },
  "premium": { "name": "Premium", "description": "...", "price": 75, "delivery": 7, "revisions": "Unlimited" }
}
Descriptions should be 1-2 sentences. Prices should be realistic for this type of service.`
  );
  if (!text) return;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const packages = JSON.parse(jsonMatch[0]);
    fillPackageInputs(packages);
  } catch {
    setStatus('Could not parse packages — try again.', 'error');
  }
}

async function fillFAQs(topic) {
  const text = await callGroq(
    `Gig: ${topic}`,
    `You are a top-rated Fiverr seller. Write 4 FAQ entries for this gig.
Return ONLY valid JSON array:
[
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." },
  { "question": "...", "answer": "..." }
]
Questions should cover common buyer concerns. Answers should be 1-3 sentences.`
  );
  if (!text) return;

  try {
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    const faqs = JSON.parse(jsonMatch[0]);
    fillFAQInputs(faqs);
  } catch {
    setStatus('Could not parse FAQs — try again.', 'error');
  }
}

// ─── DOM Helpers ──────────────────────────────────────────────────────────────

function findTitleInput() {
  const selectors = [
    'input[data-testid*="title"]',
    'input[placeholder*="title" i]',
    'input[name="title"]',
    '#gig-title',
    'input[maxlength="80"]',
    'input[class*="title"]',
  ];
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el && el.tagName === 'INPUT') return el;
  }
  // fallback: first visible text input with max length ~80
  for (const el of document.querySelectorAll('input[type="text"]')) {
    if (el.maxLength >= 60 && el.maxLength <= 100 && isVisible(el)) return el;
  }
  return null;
}

function findDescriptionTextarea() {
  const selectors = [
    'textarea[data-testid*="description"]',
    'textarea[placeholder*="describe" i]',
    'textarea[name="description"]',
  ];
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function fillQuillEditor(text) {
  const editor = document.querySelector('.ql-editor[contenteditable="true"]');
  if (!editor) return false;

  editor.focus();
  editor.innerHTML = text.split('\n').map(line => `<p>${line || '<br>'}</p>`).join('');
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function fillPackageInputs(packages) {
  const tiers = ['basic', 'standard', 'premium'];
  let filled = 0;

  // Try to find package name inputs and description inputs
  const nameInputs = document.querySelectorAll(
    'input[placeholder*="package name" i], input[placeholder*="name your package" i], input[data-testid*="package-name"]'
  );
  const descInputs = document.querySelectorAll(
    'textarea[placeholder*="describe" i], textarea[data-testid*="package-desc"]'
  );
  const priceInputs = document.querySelectorAll(
    'input[placeholder*="price" i], input[data-testid*="price"], input[type="number"][min="5"]'
  );

  tiers.forEach((tier, i) => {
    const pkg = packages[tier];
    if (!pkg) return;

    if (nameInputs[i]) { setNativeValue(nameInputs[i], pkg.name); filled++; }
    if (descInputs[i]) { setNativeValue(descInputs[i], pkg.description); filled++; }
    if (priceInputs[i]) { setNativeValue(priceInputs[i], String(pkg.price)); filled++; }
  });

  if (filled === 0) {
    setStatus('Package fields not found — open the Pricing tab.', 'error');
  }
}

function fillFAQInputs(faqs) {
  // Fiverr FAQ: pairs of question/answer inputs
  const qInputs = document.querySelectorAll(
    'input[placeholder*="question" i], input[data-testid*="faq-question"]'
  );
  const aInputs = document.querySelectorAll(
    'textarea[placeholder*="answer" i], textarea[data-testid*="faq-answer"]'
  );

  let filled = 0;
  faqs.forEach((faq, i) => {
    if (qInputs[i]) { setNativeValue(qInputs[i], faq.question); filled++; }
    if (aInputs[i]) { setNativeValue(aInputs[i], faq.answer); filled++; }
  });

  if (filled === 0) {
    setStatus('FAQ fields not found — open the Description & FAQ tab.', 'error');
  }
}

// Trigger React's synthetic onChange
function setNativeValue(el, value) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

function isVisible(el) {
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

// ─── Draggable ────────────────────────────────────────────────────────────────

function makeDraggable(el) {
  const header = el.querySelector('#fai-header');
  let ox = 0, oy = 0, sx = 0, sy = 0;

  header.addEventListener('mousedown', e => {
    e.preventDefault();
    sx = e.clientX;
    sy = e.clientY;
    ox = el.offsetLeft;
    oy = el.offsetTop;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  function onMove(e) {
    el.style.left = `${ox + e.clientX - sx}px`;
    el.style.top = `${oy + e.clientY - sy}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  if (isGigPage()) {
    injectPanel();
  }
}

// Watch for URL changes (Fiverr is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    if (isGigPage()) {
      setTimeout(injectPanel, 1000);
    } else {
      document.getElementById('fai-panel')?.remove();
      panel = null;
    }
  }
}).observe(document.body, { childList: true, subtree: true });

init();
