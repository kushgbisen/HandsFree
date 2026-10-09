/**
 * The model's contract. One system prompt, one validated step shape.
 * Everything the model may do is enumerated here — anything else is rejected
 * by validateStep before it can execute.
 */
export const ACTOR_SYSTEM = `You are HandsFree, a browser-control agent. You get ONE goal and act step by step on the live page.
Each turn you receive the page controls (pre-ranked, best first) plus what you already did.
Reply ONLY JSON: {"thought":"<brief>","done":true/false,"reason":"<required when done>","action":{"tool":"click|fill|navigate|pressEnter|scroll","index":<id>,"value":"<for fill>","target":"<full https URL for navigate>"}}
Rules:
- Choose ONLY listed indices. Never invent targets.
- click and pressEnter need index. fill needs index plus the exact value text.
- navigate needs a full https URL — use one you know, else a Google search URL (https://www.google.com/search?q=...).
- To submit a search box prefer pressEnter on it. Comment boxes need their Comment/Post button clicked after filling.
- If nothing relevant is visible, use scroll to see more.
- If the page shows an error, login wall, or captcha: done=true, reason explains the block.
- done=true only when the ORIGINAL goal is fully achieved. Keep thought and reason to one sentence each.
- History shows what you already did — never repeat an action that already worked.`;
const TOOLS = ['click', 'fill', 'navigate', 'pressEnter', 'scroll'];
function bad(error) {
  return { ok: false, error };
}
/** Executor-side guarantee: unexecutable model output never runs. */
export function validateStep(raw, count) {
  if (!raw || typeof raw !== 'object') return bad('not an object');
  const thought = typeof raw.thought === 'string' ? raw.thought.slice(0, 200) : '';
  if (raw.done === true) {
    return {
      ok: true,
      step: {
        thought,
        done: true,
        reason:
          typeof raw.reason === 'string' && raw.reason.trim() ? raw.reason.slice(0, 200) : 'done',
      },
    };
  }
  const a = raw.action;
  if (!a || typeof a !== 'object') return bad('missing action (and done is not true)');
  if (!TOOLS.includes(a.tool)) return bad(`unknown tool ${JSON.stringify(a.tool)}`);
  if (a.tool === 'click' || a.tool === 'pressEnter') {
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= count)
      return bad(`index ${JSON.stringify(a.index)} out of range 0-${count - 1}`);
    return { ok: true, step: { thought, done: false, action: { tool: a.tool, index: a.index } } };
  }
  if (a.tool === 'fill') {
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= count)
      return bad(`index ${JSON.stringify(a.index)} out of range 0-${count - 1}`);
    if (typeof a.value !== 'string' || !a.value.trim()) return bad('fill needs a non-empty value');
    return {
      ok: true,
      step: {
        thought,
        done: false,
        action: { tool: 'fill', index: a.index, value: a.value.slice(0, 500) },
      },
    };
  }
  if (a.tool === 'navigate') {
    if (typeof a.target !== 'string' || !a.target.trim()) return bad('navigate needs a target');
    return {
      ok: true,
      step: {
        thought,
        done: false,
        action: { tool: 'navigate', target: a.target.trim().slice(0, 300) },
      },
    };
  }
  return { ok: true, step: { thought, done: false, action: { tool: 'scroll' } } };
}
