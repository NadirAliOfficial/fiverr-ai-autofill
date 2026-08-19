// Tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab, .panel').forEach(el => el.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
  });
});

// Toast
function toast(msg, err = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('err', err);
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// Eye toggle
document.querySelectorAll('.eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const inp = document.getElementById(btn.dataset.t);
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '◉' : '○';
  });
});

// Rotating placeholder examples across different gig categories
const KW_PLACEHOLDERS = [
  "logo design, branding, vector art, business card",
  "wordpress website, landing page, responsive design",
  "python bot, automation, web scraping, api integration",
  "video editing, youtube shorts, reels, motion graphics",
  "seo articles, blog writing, copywriting, content creation",
  "ibkr bot, algo trading, mt5, metatrader",
  "shopify store, ecommerce, product listing, dropshipping",
  "voiceover, podcast editing, audio cleanup",
  "photoshop editing, photo retouching, background removal",
  "mobile app, react native, flutter, ios android",
];
(function rotatePlaceholder() {
  const ta = document.getElementById('fai-kw');
  if (ta.value) return;
  let i = 0;
  ta.placeholder = KW_PLACEHOLDERS[0];
  setInterval(() => {
    if (ta.value) return;
    i = (i + 1) % KW_PLACEHOLDERS.length;
    ta.placeholder = KW_PLACEHOLDERS[i];
  }, 2800);
})();

// Load all saved values
chrome.storage.local.get(['faiKeywords', 'faiEnabled', 'faiName', 'faiYears', 'faiCountry'], (d) => {
  if (d.faiKeywords) document.getElementById('fai-kw').value = d.faiKeywords;
  if (d.faiName)    document.getElementById('fai-name').value = d.faiName;
  if (d.faiYears)   document.getElementById('fai-years').value = d.faiYears;
  if (d.faiCountry) document.getElementById('fai-country').value = d.faiCountry;
  document.getElementById('faiEnabled').checked = d.faiEnabled !== false;
});

chrome.storage.sync.get(['groqKeys', 'model', 'temperature'], ({ groqKeys, model, temperature }) => {
  const keys = groqKeys || [];
  ['k1', 'k2', 'k3'].forEach((id, i) => {
    if (keys[i]) document.getElementById(id).value = keys[i];
  });
  if (model) document.getElementById('modelSelect').value = model;
  if (temperature !== undefined) {
    const t = Math.round(temperature * 10);
    document.getElementById('tempRange').value = t;
    document.getElementById('tempVal').textContent = temperature.toFixed(1);
  }
});

// Save profile + keywords
document.getElementById('saveKw').addEventListener('click', () => {
  const kw      = document.getElementById('fai-kw').value.trim();
  const name    = document.getElementById('fai-name').value.trim();
  const years   = document.getElementById('fai-years').value.trim();
  const country = document.getElementById('fai-country').value.trim();
  if (!kw) { toast('Enter at least one keyword', true); return; }
  const data = { faiKeywords: kw };
  if (name)    data.faiName    = name;
  if (years)   data.faiYears   = years;
  if (country) data.faiCountry = country;
  chrome.storage.local.set(data, () => toast('◆ Profile saved'));
});

// Toggle: show/hide buttons on Fiverr
document.getElementById('faiEnabled').addEventListener('change', function () {
  chrome.storage.local.set({ faiEnabled: this.checked });
});

// Save API keys
document.getElementById('saveKeys').addEventListener('click', () => {
  // Strip anything outside printable ASCII — pasting from WhatsApp/chat apps can
  // silently inject invisible Unicode formatting characters that break the
  // Authorization header (fetch throws "non ISO-8859-1 code point").
  const keys = ['k1', 'k2', 'k3']
    .map(id => {
      const el = document.getElementById(id);
      const clean = el.value.replace(/[^\x20-\x7E]/g, '').trim();
      el.value = clean;
      return clean;
    })
    .filter(Boolean);
  if (!keys.length) { toast('Enter at least one API key', true); return; }
  chrome.storage.sync.set({ groqKeys: keys, groqApiKey: keys[0] }, () => toast('◆ Keys saved'));
});

// Test connection
document.getElementById('testBtn').addEventListener('click', async () => {
  const keys = ['k1', 'k2', 'k3']
    .map(id => document.getElementById(id).value.replace(/[^\x20-\x7E]/g, '').trim())
    .filter(Boolean);
  if (!keys.length) { toast('Enter an API key first', true); return; }
  document.getElementById('testBtn').textContent = '…';
  const res = await chrome.runtime.sendMessage({
    type: 'GROQ_REQUEST',
    payload: { apiKey: keys[0], prompt: 'Say "OK" only.', systemPrompt: 'Reply with only "OK".' }
  });
  document.getElementById('testBtn').textContent = '▸ Test';
  if (res.error) toast('Error: ' + res.error, true);
  else toast('▸ Connection OK');
});

// Temperature slider
document.getElementById('tempRange').addEventListener('input', function () {
  document.getElementById('tempVal').textContent = (this.value / 10).toFixed(1);
});

// Save model
document.getElementById('saveModel').addEventListener('click', () => {
  const model = document.getElementById('modelSelect').value;
  const temperature = parseFloat(document.getElementById('tempRange').value) / 10;
  chrome.storage.sync.set({ model, temperature }, () => toast('◆ Model saved'));
});
