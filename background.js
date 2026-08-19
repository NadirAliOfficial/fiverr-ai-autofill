const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GROQ_REQUEST') {
    chrome.storage.sync.get(['groqKeys', 'groqApiKey', 'model', 'temperature'], (stored) => {
      const storedKeys = stored.groqKeys || (stored.groqApiKey ? [stored.groqApiKey] : []);
      // Per-call temperature (used for creative fields that need variety) wins over the saved default
      const temperature = msg.payload.temperature ?? stored.temperature;
      handleGroqRequest(msg.payload, storedKeys, stored.model, temperature)
        .then(sendResponse)
        .catch(err => sendResponse({ error: err.message }));
    });
    return true;
  }
});

async function callWithKey(apiKey, prompt, systemPrompt, model, temperature) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      temperature: temperature ?? 0.7,
      reasoning_effort: 'low', // GPT-OSS reasoning tokens count against max_tokens — keep low for faster, cheaper generations
      max_tokens: 8000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (res.status === 429 || res.status === 401) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function handleGroqRequest({ apiKey, prompt, systemPrompt }, storedKeys = [], model, temperature) {
  const keys = [...storedKeys];
  if (apiKey && !keys.includes(apiKey)) keys.push(apiKey);

  if (!keys.length) {
    throw new Error('No API key set. Open the extension popup → API Keys tab and save a Groq key.');
  }

  for (const key of keys) {
    const result = await callWithKey(key, prompt, systemPrompt, model, temperature);
    if (result !== null) return { result };
  }

  throw new Error('All Groq API keys exhausted or rate limited. Try again shortly.');
}
