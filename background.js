const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GROQ_REQUEST') {
    handleGroqRequest(msg.payload).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // async
  }
});

async function handleGroqRequest({ apiKey, prompt, systemPrompt }) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error ${res.status}`);
  }

  const data = await res.json();
  return { result: data.choices[0].message.content.trim() };
}
