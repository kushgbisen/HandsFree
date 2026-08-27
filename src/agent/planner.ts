import { z } from 'zod';
import type { Candidate } from '../browser/observe.js';
import { callLLM, hasLLM } from './llm.js';

export const PlanSchema = z.object({
  index: z.number().int().min(0).describe('id of chosen candidate from observed list'),
  reasoning: z.string().describe('brief why this candidate matches the intent'),
  value: z.string().nullable().optional().describe('value to type if candidate is fillable'),
});

export type Plan = z.infer<typeof PlanSchema>;

const SYSTEM_PROMPT = `You are HandsFree planner. You will be given a user voice transcript and a numbered list of currently observed actionable candidates. Each candidate has id, description, and selector and was confirmed to exist on the live page right now.

Rules:
- You may ONLY choose from the provided candidates. Never invent a target, never describe an element not in the list, never return an index outside the list.
- Respond with JSON: {"index": <id>, "reasoning": "<brief>", "value": "<optional for fill>"}
- If none matches perfectly, choose the closest and explain uncertainty in reasoning but still return an index.
- Keep reasoning short (1 sentence).

No prose, no extra keys, only the JSON object.`;

/**
 * Core principle: planner may only choose from what observe() just returned.
 * It never describes, guesses, or invents a target.
 */
export async function plan(transcript: string, candidates: Candidate[]): Promise<Plan> {
  if (candidates.length === 0) throw new Error('planner: no candidates observed');

  // fallback without any LLM key — still chooses from observed list (no invented targets)
  if (!hasLLM()) {
    return fallbackChoose(transcript, candidates);
  }

  const candidatesJson = JSON.stringify(
    candidates.map((c) => ({ id: c.id, description: c.description, method: c.method })),
    null,
    2,
  );

  const content = await callLLM(
    SYSTEM_PROMPT,
    `Transcript: "${transcript}"\n\nCandidates (fresh observation):\n${candidatesJson}`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`planner: invalid JSON from model: ${content.slice(0, 200)}`);
  }

  // handle wrapped shapes: { index: 3 } or { plan: { index: 3 } } or { selected: 3 }
  const raw =
    (parsed as any)?.index !== undefined
      ? parsed
      : ((parsed as any)?.plan ?? (parsed as any)?.selected ?? parsed);

  const parsedPlan = PlanSchema.parse(raw);
  // normalize null -> undefined for downstream
  const plan: Plan = {
    ...parsedPlan,
    value: parsedPlan.value ?? undefined,
  } as Plan;

  if (plan.index < 0 || plan.index >= candidates.length) {
    throw new Error(`planner: index ${plan.index} out of range (0-${candidates.length - 1})`);
  }

  return plan;
}

function fallbackChoose(transcript: string, candidates: Candidate[]): Plan {
  const t = transcript.toLowerCase();
  const words = t
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(
      (w) =>
        w.length > 1 && !['click', 'fill', 'type', 'the', 'and', 'for', 'with', 'into'].includes(w),
    );

  let bestIdx = 0;
  let bestScore = -1;

  candidates.forEach((c, idx) => {
    const desc = c.description.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (desc.includes(w)) score += 2;
    }
    // small bonus if transcript phrase appears in description
    if (words.length > 0 && desc.includes(words[0])) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  });

  return {
    index: bestIdx,
    reasoning: `fallback: chose id ${bestIdx} "${candidates[bestIdx].description}" (score ${bestScore})`,
  };
}
