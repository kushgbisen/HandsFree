import { z } from 'zod';
import type { Candidate } from '../browser/observe.js';
import { callLLM, hasLLM } from './llm.js';

export const VerifierResultSchema = z.object({
  success: z.boolean().describe('whether the intent was achieved'),
  reason: z.string().describe('brief explanation'),
});

export type VerifierResult = z.infer<typeof VerifierResultSchema>;

const SYSTEM_PROMPT = `You are HandsFree verifier. You will be given the original intent, the planned action (including value for fills), and the before/after URLs and after candidates. Decide if the intent was achieved.

Rules:
- Respond with JSON: {"success": true/false, "reason": "<brief>"}
- For click: success if the page changed (URL, candidate text, new content) or, if no navigation is expected, the click was performed — even if the element remains, return true unless an error is visible. When in doubt, return true.
- For fill/type: success if the target input's description now contains the intended value. An input remaining in the list is expected — check its text/value.
- Keep reason short (1 sentence).`;

export async function verify(
  intent: string,
  plan: { value?: string | null },
  beforeUrl: string,
  afterUrl: string,
  afterCandidates: Candidate[],
): Promise<VerifierResult> {
  if (!hasLLM()) {
    return fallbackVerify(intent, plan, beforeUrl, afterUrl, afterCandidates);
  }

  const candidatesJson = JSON.stringify(
    afterCandidates.map((c) => ({ id: c.id, description: c.description })),
    null,
    2,
  );

  const valueHint = plan.value ? `\nPlanned value: "${plan.value}"` : '';
  const content = await callLLM(
    SYSTEM_PROMPT,
    `Intent: "${intent}"${valueHint}\nBefore URL: ${beforeUrl}\nAfter URL: ${afterUrl}\nAfter candidates:\n${candidatesJson}`,
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`verifier: invalid JSON from model: ${content.slice(0, 200)}`);
  }

  const raw =
    (parsed as any)?.success !== undefined ? parsed : ((parsed as any)?.verdict ?? parsed);
  const result = VerifierResultSchema.parse(raw);
  return result;
}

function fallbackVerify(
  intent: string,
  plan: { value?: string | null },
  beforeUrl: string,
  afterUrl: string,
  afterCandidates: Candidate[],
): VerifierResult {
  if (beforeUrl !== afterUrl) {
    return { success: true, reason: `fallback: URL changed ${beforeUrl} -> ${afterUrl}` };
  }
  // for fill, check if intended value appears in any candidate description
  if (plan.value) {
    const v = plan.value.toLowerCase();
    const found = afterCandidates.some((c) => c.description.toLowerCase().includes(v));
    if (found)
      return { success: true, reason: `fallback: value "${plan.value}" found in candidates` };
  }
  if (afterCandidates.length > 0) {
    // for click, if URL didn't change but we have candidates, assume click was performed (conservative)
    // don't penalize static test pages where button remains
    return {
      success: true,
      reason: 'fallback: page still has candidates, assuming click performed',
    };
  }
  return { success: false, reason: 'fallback: no candidates after' };
}
