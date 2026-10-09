const providerSel = document.getElementById('provider') as HTMLSelectElement;
const modelInput = document.getElementById('model') as HTMLInputElement;
const modelHint = document.getElementById('modelHint') as HTMLDivElement;
const keyHint = document.getElementById('keyHint') as HTMLDivElement;
const keyInput = document.getElementById('key') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const testBtn = document.getElementById('test') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const badgeEl = document.getElementById('badge') as HTMLDivElement;
const badgeText = document.getElementById('badgeText') as HTMLSpanElement;
const eyeBtn = document.getElementById('eye') as HTMLButtonElement;
const dotEl = document.getElementById('dot') as HTMLSpanElement;

type Provider = 'aistudio' | 'openrouter' | 'deepseek' | 'openai';

const DEFAULT_MODEL: Record<Provider, string> = {
  aistudio: 'gemini-3.1-flash-lite',
  openrouter: 'google/gemini-2.0-flash-exp:free',
  deepseek: 'deepseek-chat',
  openai: 'gpt-4o-mini',
};

const KEY_HELP: Record<Provider, string> = {
  aistudio:
    'Free key — <a href="https://aistudio.google.com/app/apikey" target="_blank">aistudio.google.com/apikey →</a>',
  openrouter:
    'One key for 200+ models — <a href="https://openrouter.ai/keys" target="_blank">openrouter.ai/keys →</a>',
  deepseek:
    'Key from <a href="https://platform.deepseek.com" target="_blank">platform.deepseek.com →</a>',
  openai:
    'Key from <a href="https://platform.openai.com/api-keys" target="_blank">platform.openai.com →</a>',
};

function maskKey(k: string): string {
  if (k.length <= 8) return '•'.repeat(k.length);
  return k.slice(0, 6) + '•'.repeat(Math.min(8, k.length - 10)) + k.slice(-4);
}

function setStatus(text: string, cls: '' | 'ok' | 'err') {
  statusEl.textContent = text;
  statusEl.className = cls;
}

function refreshProviderHelp() {
  const p = providerSel.value as Provider;
  modelHint.textContent = `Default: ${DEFAULT_MODEL[p]}`;
  keyHint.innerHTML = KEY_HELP[p];
  keyInput.placeholder = p === 'aistudio' ? 'AIza…' : p === 'openrouter' ? 'sk-or-…' : 'sk-…';
}

providerSel.addEventListener('change', () => {
  const p = providerSel.value as Provider;
  const cur = modelInput.value.trim();
  // adopt the new default unless user customized the model
  if (!cur || Object.values(DEFAULT_MODEL).includes(cur)) modelInput.value = DEFAULT_MODEL[p];
  refreshProviderHelp();
  setStatus('', '');
});

async function refresh() {
  const data = (await chrome.storage.local.get([
    'apiKey',
    'provider',
    'model',
    'AISTUDIO_API_KEY',
  ])) as any;
  const key: string = data.apiKey || data.AISTUDIO_API_KEY || '';
  providerSel.value = data.provider || 'aistudio';
  modelInput.value = data.model || DEFAULT_MODEL[providerSel.value as Provider];
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

const EYE_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

eyeBtn.addEventListener('click', () => {
  keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  eyeBtn.innerHTML = keyInput.type === 'password' ? EYE_SVG : EYE_OFF_SVG;
});

function readForm(): { provider: Provider; model: string; key: string } {
  return {
    provider: providerSel.value as Provider,
    model: modelInput.value.trim() || DEFAULT_MODEL[providerSel.value as Provider],
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
    hfKeyOk: false, // force a fresh validity probe on next page load
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
