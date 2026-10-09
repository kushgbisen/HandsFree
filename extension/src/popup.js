'use strict';
const providerSel = document.getElementById('provider');
const modelInput = document.getElementById('model');
const modelHint = document.getElementById('modelHint');
const keyHint = document.getElementById('keyHint');
const keyInput = document.getElementById('key');
const saveBtn = document.getElementById('save');
const testBtn = document.getElementById('test');
const statusEl = document.getElementById('status');
const badgeEl = document.getElementById('badge');
const badgeText = document.getElementById('badgeText');
const eyeBtn = document.getElementById('eye');
const dotEl = document.getElementById('dot');
const DEFAULT_MODEL = {
  aistudio: 'gemini-3.1-flash-lite',
  openrouter: 'google/gemini-2.0-flash-exp:free',
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
};
const KEY_HELP = {
  aistudio:
    'Free key — <a href="https://aistudio.google.com/app/apikey" target="_blank">aistudio.google.com/apikey →</a>',
  openrouter:
    'One key for 200+ models — <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys →</a>',
  deepseek:
    'Key from <a href="https://platform.deepseek.com" target="_blank">platform.deepseek.com →</a>',
  openai:
    'Key from <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com →</a>',
};
function maskKey(k) {
  if (k.length <= 8) return '•'.repeat(k.length);
  return k.slice(0, 6) + '•'.repeat(Math.min(8, k.length - 10)) + k.slice(-4);
}
function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls;
}
function refreshProviderHelp() {
  const p = providerSel.value;
  modelHint.textContent = `Default: ${DEFAULT_MODEL[p]}`;
  keyHint.innerHTML = KEY_HELP[p];
  keyInput.placeholder = p === 'aistudio' ? 'AIza…' : p === 'openrouter' ? 'sk-or-…' : 'sk-…';
}
providerSel.addEventListener('change', () => {
  const p = providerSel.value;
  const cur = modelInput.value.trim();
  // adopt the new default unless user customized the model
  if (!cur || Object.values(DEFAULT_MODEL).includes(cur)) modelInput.value = DEFAULT_MODEL[p];
  refreshProviderHelp();
  setStatus('', '');
});
async function refresh() {
  const data = await chrome.storage.local.get(['apiKey', 'provider', 'model', 'AISTUDIO_API_KEY']);
  const key = data.apiKey || data.AISTUDIO_API_KEY || '';
  providerSel.value = data.provider || 'aistudio';
  modelInput.value = data.model || DEFAULT_MODEL[providerSel.value];
  refreshProviderHelp();
  if (key) {
    keyInput.value = key;
    badgeEl.classList.remove('none');
    badgeText.textContent = `Saved ✓ ${providerSel.value} · ${maskKey(key)}`;
    dotEl.classList.remove('none');
  } else {
    badgeEl.classList.add('none');
    dotEl.classList.add('none');
  }
}
eyeBtn.addEventListener('click', () => {
  keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  eyeBtn.textContent = keyInput.type === 'password' ? '👁️' : '🙈';
});
function readForm() {
  return {
    provider: providerSel.value,
    model: modelInput.value.trim() || DEFAULT_MODEL[providerSel.value],
    key: keyInput.value.trim(),
  };
}
saveBtn.addEventListener('click', async () => {
  const { provider, model, key } = readForm();
  if (!key) {
    setStatus('Paste a key first', 'err');
    return;
  }
  // generic fields llm.ts reads + legacy alias + provider-specific slot
  const providerKeyField =
    provider === 'aistudio'
      ? 'aistudioKey'
      : provider === 'openrouter'
        ? 'openrouterKey'
        : provider === 'deepseek'
          ? 'deepseekKey'
          : 'openaiKey';
  await chrome.storage.local.set({
    provider,
    model,
    apiKey: key,
    AISTUDIO_API_KEY: key,
    [providerKeyField]: key,
  });
  setStatus('Saved ✓ — close and use the on-page pill', 'ok');
  badgeEl.classList.remove('none');
  badgeText.textContent = `Saved ✓ ${provider} · ${maskKey(key)}`;
  dotEl.classList.remove('none');
  saveBtn.textContent = 'Saved ✓';
  saveBtn.classList.add('saved');
  setTimeout(() => window.close(), 800);
});
/** Test hits the real provider with a 1-token call — proves key + model work. */
testBtn.addEventListener('click', async () => {
  const { provider, model, key } = readForm();
  if (!key) {
    setStatus('Paste a key first', 'err');
    return;
  }
  testBtn.disabled = true;
  setStatus('Testing…', '');
  try {
    if (provider === 'aistudio') {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'reply with {"ok":true}' }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              maxOutputTokens: 16,
            },
          }),
        },
      );
      if (!res.ok) throw new Error(`Gemini ${res.status} — check key/model`);
    } else {
      const baseUrl =
        provider === 'openrouter'
          ? 'https://openrouter.ai/api/v1'
          : provider === 'deepseek'
            ? 'https://api.deepseek.com'
            : 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) throw new Error(`${provider} ${res.status} — key rejected`);
    }
    setStatus('Key works ✓ — hit Save', 'ok');
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Test failed', 'err');
  } finally {
    testBtn.disabled = false;
  }
});
keyInput.addEventListener('input', () => {
  saveBtn.textContent = 'Save';
  saveBtn.classList.remove('saved');
  setStatus('', '');
});
refresh();
