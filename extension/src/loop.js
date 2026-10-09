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
} from './tools.js';
import { updateHud } from './hud.js';
import { ACTOR_SYSTEM, extractJson, validateStep } from './prompts.js';
import { callLLM, hasLLM, streamLLM } from './llm.js';
import { matchOpenGoal, resolveSite } from './sites.js';
const MAX_STEPS = 5;
const SHORTLIST = 15;
const MODEL_TIMEOUT = 12000;
const FALLBACK_TIMEOUT = 8000;
const MAX_ACT_FAILURES = 2;
const fmt = (ms) => (ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
/** A timeout that really aborts the request — no orphan streams, plus user abort. */
function stepSignal(user, ms) {
  const timeout = AbortSignal.timeout(ms);
  const anyOf = AbortSignal.any;
  if (typeof anyOf === 'function') return anyOf.call(AbortSignal, [user, timeout]);
  return timeout;
}
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
function searchQueryOf(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('q') ?? u.searchParams.get('query') ?? u.searchParams.get('s');
  } catch {
    return null;
  }
}
/**
 * Local verification: URL evidence we can check without a model call.
 * Fires only for results this session produced (acted=true), so a
 * stale or unrelated query string can never fake a success.
 */
function localVerify(goal, url, startUrl, acted) {
  if (!url || !acted) return null;
  const q = searchQueryOf(url);
  if (q && /search|look up|google/i.test(goal)) {
    const words = wordsOf(goal).filter((w) => w !== 'search');
    if (words.some((w) => q.toLowerCase().includes(w))) {
      return `results for "${q}" — verified by the results URL`;
    }
    return null;
  }
  if (/^(open|go to|visit|take me to)\b/i.test(goal.trim()) && url !== startUrl && !q) {
    const host = (() => {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();
    if (wordsOf(goal).some((w) => host.includes(w))) {
      return `opened ${host} — verified by the address bar`;
    }
  }
  return null;
}
async function modelStep(goal, url, title, history, lastError, shown, tabId, signal) {
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
  let text;
  try {
    text = await streamLLM(ACTOR_SYSTEM, user, onDelta, stepSignal(signal, MODEL_TIMEOUT));
  } catch (e) {
    // user abort → propagate. HTTP status (auth/quota/model) → fail fast:
    // a non-stream retry hits the same wall and only doubles the wait.
    if (signal.aborted || e.status) throw e;
    // transport trouble (timeout, dropped stream) → one non-stream retry
    await updateHud(tabId, { thinking: false }).catch(() => {});
    text = await callLLM(ACTOR_SYSTEM, user, stepSignal(signal, FALLBACK_TIMEOUT));
  }
  await updateHud(tabId, { thinking: false }).catch(() => {});
  // null = unparseable → the caller feeds the model a precise correction
  return extractJson(text);
}
/**
 * Deterministic site opener. Pure "open X" goals never reach the model:
 * known site → navigate + verified. Unknown → navigate to a Google search
 * for it and return false so the loop clicks the result.
 */
async function tryDirectOpen(goal, tabId, signal) {
  const name = matchOpenGoal(goal);
  if (!name) return false;
  const { url, direct } = await resolveSite(name);
  await updateHud(tabId, {
    transcript: goal,
    isFinal: true,
    status: `Opening ${url}…`,
    thought: direct ? 'known site — going straight there' : `resolving "${name}" via search`,
    thinking: true,
    working: true,
  });
  throwIfAborted(signal);
  const finalUrl = await navigateTab(tabId, url, signal);
  if (!direct) return false;
  await updateHud(tabId, {
    verification: `✓ opened ${finalUrl}`,
    status: 'Verified',
    thought: `opened ${finalUrl} without guessing`,
    thinking: false,
    showStop: false,
    working: false,
  });
  return true;
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
    working: false,
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
  // one visible act sequence for click/fill/pressEnter: say it, show it, do it
  await updateHud(tabId, {
    plan: `→ ${target.description} — ${step.thought}`,
    status: `${tag}Acting...`,
    thought: step.thought,
    thinking: false,
  });
  await highlightTab(tabId, target.selector).catch(() => {}); // cosmetic — never fatal
  throwIfAborted(signal);
  if (action.tool === 'click') {
    await actOn(tabId, target);
    history.push(`clicked ${target.description}`);
    return;
  }
  if (action.tool === 'fill') {
    await actOn(tabId, target, action.value);
    history.push(`filled ${target.description} with "${action.value}"`);
    return;
  }
  // pressEnter — same highlight+status-first treatment as every other act
  const ok = await pressEnterKey(tabId, target.selector);
  if (!ok) throw new Error(`submit target gone: ${target.description}`);
  history.push(`submitted ${target.description}`);
}
export async function runGoal(goal, tabId, signal) {
  const smart = await hasLLM().catch(() => false);
  const startUrl = (await getTabMeta(tabId).catch(() => ({ url: '', title: '' }))).url;
  // pure "open X" goals skip the model entirely — deterministic, instant
  if (await tryDirectOpen(goal, tabId, signal)) return;
  const history = [];
  let lastError = '';
  let phase = '';
  let actFailures = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    throwIfAborted(signal);
    const tag = step > 0 ? `Step ${step + 1} — ` : '';
    // fresh meta every step: after a navigate, yesterday's URL/title would lie
    const meta = await getTabMeta(tabId).catch(() => ({ url: '', title: '' }));
    // URL evidence beats another model round-trip when it exists
    const verified = localVerify(goal, meta.url, startUrl, history.length > 0);
    if (verified) {
      await updateHud(tabId, {
        verification: `✓ ${verified}`,
        status: step > 0 ? `${tag}Verified` : 'Verified',
        thought: history.join(' → ') || verified,
        thinking: false,
        showStop: false,
        working: false,
      });
      return;
    }
    await updateHud(tabId, {
      transcript: step === 0 ? goal : undefined,
      isFinal: true,
      status: `${tag}Observing...`,
      thought: 'scanning controls…',
      thinking: true,
    });
    const tScan = Date.now();
    const candidates = await observeTab(tabId);
    const scanMs = Date.now() - tScan;
    if (!candidates.length) throw new Error('no candidates observed');
    const { ranked } = rankForGoal(goal, candidates);
    const shortlist = ranked.slice(0, SHORTLIST);
    const shown = shortlist.map((c, i) => ({ ...c, id: i }));
    await updateHud(tabId, {
      status: `${tag}Planning...`,
      thought: `${candidates.length} controls${phase ? ` · ${phase}` : ''}`,
      thinking: true,
    });
    if (!smart) {
      await fallbackStep(goal, tabId, shortlist);
      return;
    }
    // one validated decision (up to 2 invalid retries, then the step fails)
    let invalid = 0;
    let decided = null;
    let thinkMs = 0;
    for (;;) {
      throwIfAborted(signal);
      const tThink = Date.now();
      const raw = await modelStep(
        goal,
        meta.url,
        meta.title,
        history,
        lastError,
        shown,
        tabId,
        signal,
      );
      thinkMs = Date.now() - tThink;
      const v =
        raw === null
          ? { ok: false, error: 'reply was not valid JSON — output only the JSON object' }
          : validateStep(raw, shown.length);
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
        thought: `${history.join(' → ')}${history.length ? ' · ' : ''}${fmt(thinkMs)} to decide`,
        thinking: false,
        showStop: false,
        working: false,
      });
      return;
    }
    lastError = '';
    const tAct = Date.now();
    try {
      await execAction(tabId, decided, shortlist, signal, history, tag);
      phase = `scan ${fmt(scanMs)} · think ${fmt(thinkMs)} · act ${fmt(Date.now() - tAct)}`;
    } catch (e) {
      // a stale target or transient miss must NOT kill the command —
      // re-observe and decide again (bounded), feeding the model the reason
      if (e.name === 'AbortError' || signal.aborted) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      if (++actFailures > MAX_ACT_FAILURES) throw new Error(`action kept failing: ${msg}`);
      lastError = `action failed: ${msg}`;
      phase = `scan ${fmt(scanMs)} · think ${fmt(thinkMs)} · act failed`;
      await updateHud(tabId, {
        thought: `page changed while acting (${msg}) — re-checking…`,
        thinking: true,
      });
    }
    // loop: fresh observation becomes the verdict on what just happened
  }
  await updateHud(tabId, {
    status: 'Done',
    verification: `stopped after ${MAX_STEPS} steps`,
    thought: history.join(' → '),
    thinking: false,
    showStop: false,
    working: false,
  });
}
