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
