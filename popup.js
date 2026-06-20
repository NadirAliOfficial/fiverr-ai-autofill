const keyInput = document.getElementById('apiKey');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

chrome.storage.sync.get(['groqApiKey'], ({ groqApiKey }) => {
  if (groqApiKey) keyInput.value = groqApiKey;
});

saveBtn.addEventListener('click', () => {
  const key = keyInput.value.trim();
  if (!key) {
    status.textContent = 'Enter your API key.';
    status.style.color = '#ef9a9a';
    return;
  }
  chrome.storage.sync.set({ groqApiKey: key }, () => {
    status.textContent = 'Saved!';
    status.style.color = '#a5d6a7';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});
