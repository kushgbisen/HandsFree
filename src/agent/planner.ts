import OpenAI from 'openai';
import { z } from 'zod';

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? 'dummy',
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
});

export const ActionSchema = z.array(
  z.object({
    type: z.enum(['click', 'fill']),
    target: z.string().describe('natural language description of element to act on'),
    value: z.string().optional().describe('value to fill — required when type is fill'),
  }),
);

export type Action = z.infer<typeof ActionSchema>[number];

const SYSTEM_PROMPT = `You are HandsFree planner. Given user transcript and a DOM snapshot, return a JSON array of actions.
Each action: { "type": "click" | "fill", "target": "<short description>", "value"?: "<for fill>" }.
Only use "click" and "fill". Prefer "click" for buttons/links. Keep target short (2-5 words).
Return ONLY valid JSON — either an array or {"actions": [...] }. No prose.`;

export async function plan(transcript: string, domSnapshot: string): Promise<Action[]> {
  const trimmedSnapshot = domSnapshot.slice(0, 8000);

  // fallback without API key — lets Hour 1-3 work offline
  if (!process.env.DEEPSEEK_API_KEY) {
    const t = transcript.toLowerCase();
    if (t.includes('sign in') || t.includes('signin') || t.includes('log in')) {
      return [{ type: 'click', target: 'sign in' }];
    }
    // strip leading verb for better matching ("click X" -> "X")
    let target = transcript.trim();
    const lower = target.toLowerCase();
    if (lower.startsWith('click ')) target = target.slice(6).trim();
    else if (lower.startsWith('fill ')) target = target.slice(5).trim();
    return [{ type: 'click', target: target.slice(0, 80) || transcript.slice(0, 80) }];
  }

  const res = await openai.chat.completions.create({
    model: 'deepseek-chat',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Transcript: "${transcript}"\n\nDOM snapshot (truncated):\n${trimmedSnapshot}`,
      },
    ],
  });

  const content = res.choices[0]?.message?.content ?? '[]';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`planner: invalid JSON from model: ${content.slice(0, 200)}`);
  }

  const actionsRaw = Array.isArray(parsed)
    ? parsed
    : ((parsed as { actions?: unknown; plan?: unknown }).actions ??
      (parsed as { plan?: unknown }).plan ??
      parsed);

  return ActionSchema.parse(actionsRaw);
}
