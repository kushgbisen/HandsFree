export async function getConfig() {
  const data = await chrome.storage.local.get([
    'apiKey',
    'provider',
    'model',
    'aistudioKey',
    'openrouterKey',
    'deepseekKey',
    'openaiKey',
  ]);
  // popup stores apiKey generically, plus explicit provider/model
  const provider = data.provider || detectProvider(data);
  const apiKey =
    data.apiKey ||
    data.aistudioKey ||
    data.openrouterKey ||
    data.deepseekKey ||
    data.openaiKey ||
    (await chrome.storage.local.get('AISTUDIO_API_KEY')).AISTUDIO_API_KEY;
  if (!apiKey) return null;
  if (provider === 'openrouter') {
    return {
      provider: 'openrouter',
      apiKey,
      model: data.model || 'google/gemini-2.0-flash-exp:free',
      baseUrl: 'https://openrouter.ai/api/v1',
    };
  }
  // default to aistudio gemini for free tier
  return {
    provider: 'aistudio',
    apiKey,
    model: data.model || 'gemini-3.1-flash-lite',
  };
}
function detectProvider(data) {
  if (data.openrouterKey) return 'openrouter';
  if (data.aistudioKey) return 'aistudio';
  if (data.deepseekKey) return 'deepseek';
  if (data.openaiKey) return 'openai';
  return 'aistudio';
}
function openAIBaseUrl(provider) {
  return provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1'
    : provider === 'deepseek'
      ? 'https://api.deepseek.com'
      : 'https://api.openai.com/v1';
}
/**
 * Streaming LLM call (SSE) — pushes growing text to onDelta so the pill
 * can show live thinking. Throws on any failure; caller falls back to callLLM.
 */
export async function streamLLM(system, user, onDelta) {
  const cfg = await getConfig();
  if (!cfg) throw new Error('No API key — set in HandsFree popup');
  let url;
  let body;
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.provider === 'aistudio') {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:streamGenerateContent?alt=sse&key=${cfg.apiKey}`;
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    };
  } else {
    url = `${openAIBaseUrl(cfg.provider)}/chat/completions`;
    if (cfg.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/handsfree';
      headers['X-Title'] = 'HandsFree';
    }
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;
    body = {
      model: cfg.model,
      temperature: 0.1,
      stream: true,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let acc = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        const piece =
          cfg.provider === 'aistudio'
            ? (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('')
            : (j.choices?.[0]?.delta?.content ?? '');
        if (piece) {
          acc += piece;
          onDelta(acc);
        }
      } catch {
        // partial chunk — more bytes coming
      }
    }
  }
  if (!acc.trim()) throw new Error('empty stream');
  return acc;
}
export async function hasLLM() {
  return (await getConfig().catch(() => null)) !== null;
}
/** Cheap validity probe: one tiny request, 8 s cap. Throws when rejected. */
export async function validateKey() {
  const cfg = await getConfig();
  if (!cfg) throw new Error('no key saved');
  const signal = AbortSignal.timeout(8000);
  if (cfg.provider === 'aistudio') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}?key=${cfg.apiKey}`,
      { signal },
    );
    if (!res.ok) throw new Error(`rejected (${res.status}) — check key and model`);
    return;
  }
  const headers = { Authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/handsfree';
    headers['X-Title'] = 'HandsFree';
  }
  const res = await fetch(`${openAIBaseUrl(cfg.provider)}/models`, { headers, signal });
  if (!res.ok) throw new Error(`rejected (${res.status}) — check key and model`);
}
export async function callLLM(system, user) {
  const cfg = await getConfig();
  if (!cfg) throw new Error('No API key — set in HandsFree popup');
  if (cfg.provider === 'aistudio') {
    // use Gemini API directly via fetch (no SDK in extension to keep bundle small)
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    const j = await res.json();
    return j.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  }
  // OpenAI-compatible (openrouter, deepseek, openai)
  const baseUrl =
    cfg.provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : cfg.provider === 'deepseek'
        ? 'https://api.deepseek.com'
        : 'https://api.openai.com/v1';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
      ...(cfg.provider === 'openrouter'
        ? { 'HTTP-Referer': 'https://github.com/handsfree', 'X-Title': 'HandsFree' }
        : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${cfg.provider} ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '{}';
}
