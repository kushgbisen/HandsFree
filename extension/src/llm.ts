export type Provider = 'openrouter' | 'aistudio' | 'deepseek' | 'openai' | 'generic';

export async function getConfig(): Promise<{
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string;
} | null> {
  const data = (await chrome.storage.local.get([
    'apiKey',
    'provider',
    'model',
    'aistudioKey',
    'openrouterKey',
    'deepseekKey',
    'openaiKey',
  ])) as any;
  // popup stores apiKey generically, plus explicit provider/model
  const provider = (data.provider as Provider) || detectProvider(data);
  const apiKey =
    data.apiKey ||
    data.aistudioKey ||
    data.openrouterKey ||
    data.deepseekKey ||
    data.openaiKey ||
    ((await chrome.storage.local.get('AISTUDIO_API_KEY')) as any).AISTUDIO_API_KEY;

  if (!apiKey) return null;

  if (provider === 'openrouter') {
    return {
      provider: 'openrouter',
      apiKey,
      model: (data as any).model || 'google/gemini-2.0-flash-exp:free',
      baseUrl: 'https://openrouter.ai/api/v1',
    };
  }
  // default to aistudio gemini for free tier
  return {
    provider: 'aistudio',
    apiKey,
    model: (data as any).model || 'gemini-3.1-flash-lite',
  };
}

function detectProvider(data: any): Provider {
  if (data.openrouterKey) return 'openrouter';
  if (data.aistudioKey) return 'aistudio';
  if (data.deepseekKey) return 'deepseek';
  if (data.openaiKey) return 'openai';
  return 'aistudio';
}

function openAIBaseUrl(provider: Provider): string {
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
export async function streamLLM(
  system: string,
  user: string,
  onDelta: (accumulated: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const cfg = await getConfig();
  if (!cfg) throw new Error('No API key — set in HandsFree popup');

  let url: string;
  let body: unknown;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
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

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    // status-tagged: the caller must NOT retry a non-stream call on auth or
    // quota errors — it would fail identically and double the wait
    const text = await res.text().catch(() => '');
    const err: Error & { status?: number } = new Error(
      `HTTP ${res.status}: ${text.slice(0, 160) || res.statusText}`,
    );
    err.status = res.status;
    throw err;
  }

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
            ? (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
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

export async function hasLLM(): Promise<boolean> {
  return (await getConfig().catch(() => null)) !== null;
}

/** Cheap validity probe: one tiny request, 8 s cap. Throws when rejected. */
export async function validateKey(): Promise<void> {
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
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/handsfree';
    headers['X-Title'] = 'HandsFree';
  }
  const res = await fetch(`${openAIBaseUrl(cfg.provider)}/models`, { headers, signal });
  if (!res.ok) throw new Error(`rejected (${res.status}) — check key and model`);
}

export async function callLLM(system: string, user: string, signal?: AbortSignal): Promise<string> {
  const cfg = await getConfig();
  if (!cfg) throw new Error('No API key — set in HandsFree popup');

  if (cfg.provider === 'aistudio') {
    // use Gemini API directly via fetch (no SDK in extension to keep bundle small)
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
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
    signal,
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

/**
 * Voice transcription with the saved provider key — the second half of our
 * own audio pipeline (getUserMedia + MediaRecorder live in content.ts).
 * Gemini transcribes audio natively; OpenAI-compatible providers use Whisper.
 */
export async function transcribeAudio(
  b64: string,
  mime: string,
  signal?: AbortSignal,
): Promise<string> {
  const cfg = await getConfig();
  if (!cfg) throw new Error('No API key — set in HandsFree popup');
  const timeout = AbortSignal.timeout(25000);
  const anyOf = (AbortSignal as unknown as { any?: (sigs: AbortSignal[]) => AbortSignal }).any;
  const sig =
    signal && typeof anyOf === 'function' ? anyOf.call(AbortSignal, [signal, timeout]) : timeout;
  const cleanMime = mime.split(';')[0] || 'audio/webm';

  if (cfg.provider === 'aistudio') {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: sig,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: cleanMime, data: b64 } },
                {
                  text: 'Transcribe this short voice command exactly. Reply with ONLY the transcribed words, no quotes or commentary.',
                },
              ],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: 100 },
        }),
      },
    );
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      const err: Error & { status?: number } = new Error(
        `HTTP ${res.status}: ${t.slice(0, 160) || res.statusText}`,
      );
      err.status = res.status;
      throw err;
    }
    const j = await res.json();
    const text = ((j.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string }>)
      .map((p) => p.text ?? '')
      .join('')
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, '');
    if (!text) throw new Error('transcription came back empty — speak closer and try again');
    return text;
  }

  if (cfg.provider === 'deepseek' || cfg.provider === 'generic') {
    throw new Error('voice needs a Gemini or OpenAI-compatible key — type instead for now');
  }
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('file', new Blob([bin], { type: cleanMime }), 'cmd.webm');
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/handsfree';
    headers['X-Title'] = 'HandsFree';
  }
  const res = await fetch(`${openAIBaseUrl(cfg.provider)}/audio/transcriptions`, {
    method: 'POST',
    headers,
    signal: sig,
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err: Error & { status?: number } = new Error(
      `HTTP ${res.status}: ${t.slice(0, 160) || res.statusText}`,
    );
    err.status = res.status;
    throw err;
  }
  const j = await res.json();
  const text = ((j.text ?? '') as string).trim();
  if (!text) throw new Error('transcription came back empty — speak closer and try again');
  return text;
}
