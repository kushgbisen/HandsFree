const keyInput = document.getElementById('key') as HTMLInputElement;
chrome.storage.local.get('apiKey').then((v) => (keyInput.value = v.apiKey ?? ''));
document.getElementById('save')!.addEventListener('click', async () => {
  await chrome.storage.local.set({ apiKey: keyInput.value.trim() });
  window.close();
});
