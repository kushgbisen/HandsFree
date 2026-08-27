import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

type Provider = 'openrouter' | 'aistudio' | 'deepseek' | 'openai' | 'generic';

type LLMConfig =
  | { provider: 'openrouter'; apiKey: string; model: string; baseUrl: string }
  | { provider: 'aistudio'; apiKey: string; model: string }
  | { provider: 'deepseek'; apiKey: string; model: string; baseUrl: string }
  | { provider: 'openai'; apiKey: string; model: string; baseUrl: string }
  | { provider: 'generic'; apiKey: string; model: string; baseUrl: string };

function getConfig(): LLMConfig | null {
  const explicit = process.env.LLM_PROVIDER as Provider | undefined;

  // helper to pick first available key
  const aistudioKey =
    process.env.AISTUDIO_API_KEY ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const genericKey = process.env.LLM_API_KEY;

  if (explicit) {
    switch (explicit) {
      case 'openrouter':
        if (!openrouterKey) return null;
        return {
          provider: 'openrouter',
          apiKey: openrouterKey,
          model: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-exp:free',
          baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
        };
      case 'aistudio':
        if (!aistudioKey) return null;
        return {
          provider: 'aistudio',
          apiKey: aistudioKey,
          model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
        };
      case 'deepseek':
        if (!deepseekKey) return null;
        return {
          provider: 'deepseek',
          apiKey: deepseekKey,
          model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
          baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        };
      case 'openai':
        if (!openaiKey) return null;
        return {
          provider: 'openai',
          apiKey: openaiKey,
          model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
          baseUrl: 'https://api.openai.com/v1',
        };
      case 'generic':
        if (!genericKey || !process.env.LLM_BASE_URL) return null;
        return {
          provider: 'generic',
          apiKey: genericKey,
          model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
          baseUrl: process.env.LLM_BASE_URL!,
        };
    }
  }

  // auto-detect priority: openrouter > aistudio > deepseek > openai > generic
  if (openrouterKey) {
    return {
      provider: 'openrouter',
      apiKey: openrouterKey,
      model: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-exp:free',
      baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
    };
  }
  if (aistudioKey) {
    return {
      provider: 'aistudio',
      apiKey: aistudioKey,
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    };
  }
  if (deepseekKey) {
    return {
      provider: 'deepseek',
      apiKey: deepseekKey,
      model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    };
  }
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    };
  }
  if (genericKey && process.env.LLM_BASE_URL) {
    return {
      provider: 'generic',
      apiKey: genericKey,
      model: process.env.LLM_MODEL ?? 'gpt-4o-mini',
      baseUrl: process.env.LLM_BASE_URL!,
    };
  }
  return null;
}

export function hasLLM(): boolean {
  return getConfig() !== null;
}

export function getLLMInfo(): string {
  const cfg = getConfig();
  if (!cfg) return 'none (fallback)';
  return `${cfg.provider}:${cfg.model}`;
}

/**
 * Unified LLM call — works with OpenRouter, AI Studio (Gemini), DeepSeek, OpenAI.
 * Returns raw string content (expected to be JSON).
 */
export async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const cfg = getConfig();
  if (!cfg)
    throw new Error(
      'no LLM config — set one of OPENROUTER_API_KEY, AISTUDIO_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY',
    );

  if (cfg.provider === 'aistudio') {
    return callGemini(cfg, systemPrompt, userPrompt);
  }
  return callOpenAICompatible(cfg as any, systemPrompt, userPrompt);
}

async function callOpenAICompatible(
  cfg: { apiKey: string; model: string; baseUrl: string; provider: string },
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const client = new OpenAI({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseUrl,
    // openrouter recommends these headers but not required
    defaultHeaders:
      cfg.provider === 'openrouter'
        ? {
            'HTTP-Referer': 'https://github.com/handsfree',
            'X-Title': 'HandsFree',
          }
        : undefined,
  });

  const res = await client.chat.completions.create({
    model: cfg.model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  return res.choices[0]?.message?.content ?? '{}';
}

async function callGemini(
  cfg: { apiKey: string; model: string },
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const genAI = new GoogleGenerativeAI(cfg.apiKey);
  const model = genAI.getGenerativeModel({
    model: cfg.model,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    } as any,
  });

  const result = await model.generateContent(userPrompt);
  const text = result.response.text();
  return text ?? '{}';
}
