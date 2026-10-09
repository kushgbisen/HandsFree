/**
 * ReAct goal loop. One model decision per step: {thought, action} or {done}.
 * The executor guarantees: validated actions only, abort checks everywhere,
 * bounded steps, and every outcome fed back as the next observation.
 */
import {
  actOn,
  getTabMeta,
  highlightTab,
  navigateTab,
  observeTab,
  pressEnterKey,
  scrollOnce,
  withTimeout,
} from './tools.js';
import { updateHud } from './hud.js';
import { ACTOR_SYSTEM, validateStep } from './prompts.js';
import { callLLM, hasLLM, streamLLM } from './llm.js';
const MAX_STEPS = 5;
const SHORTLIST = 15;
const MODEL_TIMEOUT = 12000;
// --- ranking: prompt-size compression only, never a decision ---
const STOPWORDS = new Set([
  'click',
  'press',
  'tap',
  'hit',
  'fill',
  'type',
  'enter',
  'put',
  'set',
  'the',
  'a',
  'an',
  'and',
  'for',
  'with',
  'into',
  'in',
  'on',
  'to',
  'please',
  'this',
  'that',
  'it',
  'my',
  'me',
  'go',
  'open',
  'website',
  'site',
  'page',
  'official',
]);
function wordsOf(t) {
  return t
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}
function rankForGoal(goal, candidates) {
  const words = wordsOf(goal);
  const fillIntent =
    !/omit value|no text to type/i.test(goal) &&
    /comment|fill|type|search|write|say|enter|post|publish/i.test(goal);
  const scored = candidates.map((c) => {
    const desc = c.description.toLowerCase();
    let s = 0;
    if (fillIntent && c.method === 'fill') s += 3;
    for (const w of words) {
      if (desc.includes(`"${w}`)) s += 3;
      else if (desc.includes(w)) s += 2;
    }
    if (words.length > 0 && desc.includes(words.join(' '))) s += 2;
    return { c, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return { ranked: scored.map((x) => x.c), best: scored.length ? scored[0].s : 0 };
}
function throwIfAborted(signal) {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
}
function normalizeNavigateTarget(target) {
  const t = target.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (!/\s/.test(t)) return `https://${t}`;
  // a name, not a URL — model was told to send URLs; search it
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}
async function modelStep(goal, url, title, history, lastError, shown, tabId) {
  const user =
    `Goal: "${goal}"\nPage: ${title} <${url}>\n` +
    `History:\n${history.length ? history.map((h) => `- ${h}`).join('\n') : '(none yet)'}\n` +
    (lastError ? `Last error: ${lastError}\n` : '') +
    `Controls (best first):\n${JSON.stringify(
      shown.map((c) => ({ id: c.id, description: c.description, method: c.method })),
      null,
      2,
    )}`;
  let last = 0;
  const onDelta = (delta) => {
    const now = Date.now();
    if (now - last > 150) {
      last = now;
      updateHud(tabId, { thought: delta.slice(0, 140), thinking: true }).catch(() => {});
    }
  };
  try {
    const text = await withTimeout(streamLLM(ACTOR_SYSTEM, user, onDelta), MODEL_TIMEOUT);
    await updateHud(tabId, { thinking: false }).catch(() => {});
    return JSON.parse(text);
  } catch {
    await updateHud(tabId, { thinking: false }).catch(() => {});
    const text = await withTimeout(callLLM(ACTOR_SYSTEM, user), 10000);
    return JSON.parse(text);
  }
}
/** No-key degraded mode: one crude act, then done. A rule, not intelligence. */
async function fallbackStep(goal, tabId, shortlist) {
  const top = shortlist[0];
  await highlightTab(tabId, top.selector).catch(() => {});
  let value;
  if (top.method === 'fill') {
    const m = goal.match(/ with (.+)$/i);
    value = m ? m[1].trim().replace(/[.?!'"]+$/, '') : undefined;
  }
  await actOn(tabId, top, value);
  await updateHud(tabId, {
    verification: `basic mode: acted on ${top.description} — set a key for smart mode`,
    status: 'Done',
    thinking: false,
    showStop: false,
  });
}
async function execAction(tabId, step, shortlist, signal, history, tag) {
  const action = step.action;
  if (action.tool === 'scroll') {
    await scrollOnce(tabId);
    history.push('scrolled for more controls');
    await updateHud(tabId, {
      status: `${tag}Observing...`,
      thought: 'looking further…',
      thinking: true,
    });
    return;
  }
  if (action.tool === 'navigate') {
    const url = normalizeNavigateTarget(action.target);
    await updateHud(tabId, {
      status: `${tag}Opening ${url}…`,
      thought: step.thought,
      thinking: false,
      working: true,
    });
    const finalUrl = await navigateTab(tabId, url, signal);
    history.push(`opened ${finalUrl}`);
    return;
  }
  const target = shortlist[action.index];
  if (action.tool === 'click') {
    await updateHud(tabId, {
      plan: `→ ${target.description} — ${step.thought}`,
      status: `${tag}Acting...`,
      thought: step.thought,
      thinking: false,
    });
    await highlightTab(tabId, target.selector);
    throwIfAborted(signal);
    await actOn(tabId, target);
    history.push(`clicked ${target.description}`);
    return;
  }
  if (action.tool === 'fill') {
    await updateHud(tabId, {
      plan: `→ ${target.description} — ${step.thought}`,
      status: `${tag}Acting...`,
      thought: step.thought,
      thinking: false,
    });
    await highlightTab(tabId, target.selector);
    throwIfAborted(signal);
    await actOn(tabId, target, action.value);
    history.push(`filled ${target.description} with "${action.value}"`);
    return;
  }
  // pressEnter
  throwIfAborted(signal);
  await pressEnterKey(tabId, target.selector);
  history.push(`submitted ${target.description}`);
  await updateHud(tabId, {
    plan: `→ ${target.description} — ${step.thought}`,
    status: `${tag}Acting...`,
    thought: step.thought,
    thinking: false,
  });
}
export async function runGoal(goal, tabId, signal) {
  const smart = await hasLLM().catch(() => false);
  const meta = await getTabMeta(tabId).catch(() => ({ url: '', title: '' }));
  const history = [];
  let lastError = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    throwIfAborted(signal);
    const tag = step > 0 ? `Step ${step + 1} — ` : '';
    await updateHud(tabId, {
      transcript: step === 0 ? goal : undefined,
      isFinal: true,
      status: `${tag}Observing...`,
      thought: 'scanning controls…',
      thinking: true,
    });
    const candidates = await observeTab(tabId);
    if (!candidates.length) throw new Error('no candidates observed');
    const { ranked } = rankForGoal(goal, candidates);
    const shortlist = ranked.slice(0, SHORTLIST);
    const shown = shortlist.map((c, i) => ({ ...c, id: i }));
    await updateHud(tabId, {
      status: `${tag}Planning...`,
      thought: `${candidates.length} controls · top match ${shortlist[0]?.description ?? '—'}`,
      thinking: true,
    });
    if (!smart) {
      await fallbackStep(goal, tabId, shortlist);
      return;
    }
    // one validated decision (up to 2 invalid retries, then the step fails)
    let invalid = 0;
    let decided = null;
    for (;;) {
      const raw = await modelStep(goal, meta.url, meta.title, history, lastError, shown, tabId);
      const v = validateStep(raw, shown.length);
      if (v.ok) {
        decided = v.step;
        break;
      }
      lastError = v.error;
      if (++invalid > 2) throw new Error(`model gave invalid actions (${v.error})`);
      await updateHud(tabId, { thought: `correcting: ${v.error}`, thinking: true });
    }
    if (decided.done) {
      await updateHud(tabId, {
        verification: `✓ ${decided.reason ?? 'done'}`,
        status: step > 0 ? `${tag}Verified` : 'Verified',
        thought: history.join(' → ') || decided.reason,
        thinking: false,
        showStop: false,
      });
      return;
    }
    lastError = '';
    await execAction(tabId, decided, shortlist, signal, history, tag);
    // loop: fresh observation becomes the verdict on what just happened
  }
  await updateHud(tabId, {
    status: 'Done',
    verification: `stopped after ${MAX_STEPS} steps`,
    thought: history.join(' → '),
    thinking: false,
    showStop: false,
  });
}
