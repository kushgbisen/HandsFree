/**
 * HandsFree — MV3 background service worker (no Node, no Playwright)
 * Fix #1 keepalive via Port + storage.session checkpoint
 */
import { callLLM, streamLLM } from './llm.js';

type Candidate = {
  id: number;
  selector: string;
  description: string;
  method?: string;
  role?: string;
};
type Plan = { index: number; reasoning: string; value?: string };

const queue: Array<{ run: () => Promise<void>; controller: AbortController }> = [];
let running = false;
let currentAbort = new AbortController();
// the controller of the command actually executing — "stop" aborts THIS,
// not whatever controller was created last
let runningController: AbortController | null = null;

// keepalive
const ports = new Set<chrome.runtime.Port>();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function observe(tabId: number): Promise<Candidate[]> {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'observe' });
  return res?.candidates ?? [];
}

async function highlight(tabId: number, selector: string): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'highlight', selector });
}

async function act(tabId: number, candidate: Candidate, value?: string): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'act', candidate, value });
}

async function pressEnter(tabId: number, selector: string): Promise<boolean> {
  const res = await chrome.tabs
    .sendMessage(tabId, { type: 'pressEnter', selector })
    .catch(() => null);
  return !!res?.ok;
}

async function updateHud(tabId: number, update: any): Promise<void> {
  chrome.tabs.sendMessage(tabId, { type: 'hud', update }).catch(() => {});
}

async function scrollPage(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'scroll' }).catch(() => {});
}

// --- intent ranking: cheap keyword scoring so the LLM only sees the top 15 ---
const INTENT_STOPWORDS = new Set([
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
const VERB_ONLY = new Set(['click', 'press', 'tap', 'hit', 'fill', 'type', 'open', 'go']);

function intentWords(transcript: string): string[] {
  return transcript
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 1 && !INTENT_STOPWORDS.has(w));
}

/** Fill-like intents ("comment X", "search Y") target boxes, not the words themselves. */
function isFillIntent(transcript: string): boolean {
  if (/omit value|no text to type/i.test(transcript)) return false;
  return /comment|fill|type|search|write|say|enter|post|publish/i.test(transcript);
}

function scoreCandidate(words: string[], fillIntent: boolean, c: Candidate): number {
  const desc = c.description.toLowerCase();
  let s = 0;
  if (fillIntent && c.method === 'fill') s += 3;
  for (const w of words) {
    if (desc.includes(`"${w}`)) s += 3;
    else if (desc.includes(w)) s += 2;
  }
  if (words.length > 0 && desc.includes(words.join(' '))) s += 2;
  return s;
}

function rankCandidates(
  transcript: string,
  candidates: Candidate[],
  noFillBonus = false,
): { ranked: Candidate[]; best: number } {
  const words = intentWords(transcript);
  const fillIntent = !noFillBonus && isFillIntent(transcript);
  const scored = candidates.map((c) => ({ c, s: scoreCandidate(words, fillIntent, c) }));
  scored.sort((a, b) => b.s - a.s);
  return { ranked: scored.map((x) => x.c), best: scored.length ? scored[0].s : 0 };
}

export type PageCtx = { tabId?: number; url?: string; title?: string };

async function planWithLLM(
  transcript: string,
  candidates: Candidate[],
  ctx?: PageCtx,
): Promise<Plan> {
  // pre-ranked shortlist: model sees top 15, best first — index maps back below
  const { ranked } = rankCandidates(transcript, candidates);
  const shortlist = ranked.slice(0, 15).map((c, i) => ({ ...c, id: i }));
  const system = `You are HandsFree planner. Choose ONLY from candidates (pre-ranked by relevance, best first). Return {"index":<id>,"reasoning":"<brief>","value":"<optional text to type>"}
Rules for "value": when the intent contains words to write, put them in value and pick the input/box to write into.
- "comment nice video" on a comment box -> value "nice video"
- "fill Email with test@example.com" -> value "test@example.com"
- "search for cats" on a search box -> value "cats"
- Pure clicks ("click sign in", "post it") -> omit value.
Never invent a target or index outside the list. One sentence of reasoning.`;
  const pageLine = ctx?.url ? `Page: ${ctx.title || ''} <${ctx.url}>\n` : '';
  const user = `${pageLine}Transcript: "${transcript}"\nCandidates:\n${JSON.stringify(
    shortlist.map((c) => ({ id: c.id, description: c.description, method: c.method })),
    null,
    2,
  )}`;
  // live thought stream when we have a tab to narrate to, plain call otherwise
  let text: string;
  if (ctx?.tabId !== undefined) {
    const tabId = ctx.tabId;
    try {
      let last = 0;
      text = await streamLLM(system, user, (delta) => {
        const now = Date.now();
        if (now - last > 150) {
          last = now;
          updateHud(tabId, { thought: delta.slice(0, 140), thinking: true }).catch(() => {});
        }
      });
      await updateHud(tabId, { thinking: false }).catch(() => {});
    } catch {
      await updateHud(tabId, { thinking: false }).catch(() => {});
      text = await callLLM(system, user);
    }
  } else {
    text = await callLLM(system, user);
  }
  const parsed = JSON.parse(text);
  const raw = parsed.index !== undefined ? parsed : (parsed.plan ?? parsed);
  if (raw.index < 0 || raw.index >= shortlist.length)
    throw new Error(`index ${raw.index} out of range`);
  // ranked[] holds original refs whose .id is the original position —
  // map the model's shortlist pick back so callers index the full array.
  return {
    index: ranked[raw.index].id,
    reasoning: raw.reasoning ?? '',
    value: raw.value ?? undefined,
  };
}

/** Pull the words-to-type out of the transcript when there is no LLM. */
function extractValue(transcript: string): string | undefined {
  if (/omit value|no text to type/i.test(transcript)) return undefined;
  const pats = [
    /(?:comment|say|write)\s+(.+)/i,
    /search(?: for)?\s+(.+)/i,
    /fill\s+.+?\s+with\s+(.+)/i,
    /type\s+(.+?)(?:\s+(?:in|into|inside)\b.*)?$/i,
  ];
  for (const p of pats) {
    const m = transcript.match(p);
    if (m && m[1].trim()) return m[1].trim().replace(/[.?!'"]+$/, '');
  }
  return undefined;
}

/** "open X" / "go to Y" — only when the intent starts with the verb. */
function extractNavIntent(transcript: string): { target: string; rest: string } | null {
  const m = transcript.match(
    /^(?:please\s+)?(?:open|go to|visit|launch|take me to|navigate to)\s+(.+)/i,
  );
  if (!m || !m[1].trim()) return null;
  const full = m[1].trim().replace(/[.?!]+$/, '');
  const andIdx = full.search(/\s+and\s+(?=[a-z])/i);
  if (andIdx > 0) {
    const rest = full
      .slice(andIdx)
      .replace(/^\s+and\s+/i, '')
      .replace(/^(then\s+)/i, '')
      .trim();
    return { target: full.slice(0, andIdx).trim(), rest };
  }
  return { target: full, rest: '' };
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** One tiny call: name → official homepage. Null when unknown. */
async function resolveSiteUrl(name: string): Promise<{ url: string; hint: string } | null> {
  const system = `You map site names to official homepage URLs. Reply ONLY JSON {"url":"<https url>","hint":"<main domain word>"} or {"url":null}. Example: "myupes" -> {"url":"https://www.upes.ac.in","hint":"upes"}. Unknown -> {"url":null}.`;
  const text = await withTimeout(callLLM(system, `Site name: "${name}"`), 10000);
  const parsed = JSON.parse(text);
  const raw = parsed.url !== undefined ? parsed : (parsed.site ?? parsed);
  if (!raw || typeof raw.url !== 'string' || !/^https?:\/\//i.test(raw.url)) return null;
  return {
    url: raw.url,
    hint: String(raw.hint ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ''),
  };
}

/** Polls tab status until loaded (abort-aware). Returns the live URL. */
async function waitForPageLive(
  tabId: number,
  signal: AbortSignal,
  timeoutMs = 12000,
): Promise<string> {
  const start = Date.now();
  let lastUrl = '';
  for (;;) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('tab went away');
    if (tab.url) lastUrl = tab.url;
    if (tab.status === 'complete' && tab.url) return tab.url;
    if (Date.now() - start > timeoutMs) {
      if (lastUrl) return lastUrl;
      throw new Error('page took too long to load');
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/**
 * Lands the tab on the named site and CHECKS it: direct URLs go straight,
 * names resolve in one small call, unknowns fall back to Google search,
 * and a wrong-domain landing retries via search. Throws on failure.
 */
async function openSite(
  tabId: number,
  target: string,
  signal: AbortSignal,
): Promise<{ url: string }> {
  const clean =
    target
      .replace(/\b(official\s+)?(website|web\s*site|site|webpage|page|portal|homepage|app)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || target.trim();

  let url: string | null = null;
  let hint = '';
  if (/^https?:\/\//i.test(clean)) {
    url = clean;
  } else if (/^localhost/i.test(clean)) {
    url = `http://${clean}`;
  } else if (/[.:]\w{2,}/i.test(clean) && !/\s/.test(clean)) {
    url = `https://${clean}`;
  } else {
    try {
      const r = await withTimeout(resolveSiteUrl(clean), 12000);
      if (r?.url) {
        url = r.url;
        hint = r.hint;
      }
    } catch {
      url = null;
    }
    if (!url) url = `https://www.google.com/search?q=${encodeURIComponent(clean)}`;
  }

  await chrome.tabs.update(tabId, { url });
  const finalUrl = await waitForPageLive(tabId, signal);
  if (hint) {
    const host = safeHostname(finalUrl);
    const hostCore = host.split('.')[0];
    if (host && !host.includes(hint) && !hint.includes(hostCore)) {
      const g = `https://www.google.com/search?q=${encodeURIComponent(clean)}`;
      await chrome.tabs.update(tabId, { url: g });
      return { url: await waitForPageLive(tabId, signal) };
    }
  }
  return { url: finalUrl };
}

function fallbackPlan(transcript: string, candidates: Candidate[]): Plan {
  const { ranked, best } = rankCandidates(transcript, candidates);
  const verb = Array.from(VERB_ONLY).find((v) => transcript.toLowerCase().includes(v)) ?? 'act on';
  return {
    index: ranked[0].id,
    reasoning: `fallback: ${verb} ${ranked[0].description} (score ${best})`,
    value: extractValue(transcript),
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function fallbackVerify(
  plan: Plan,
  beforeUrl: string,
  afterUrl: string,
  afterCandidates: Candidate[],
): { success: boolean; reason: string } {
  if (beforeUrl !== afterUrl) return { success: true, reason: `URL changed` };
  if (plan.value) {
    const v = plan.value.toLowerCase();
    if (afterCandidates.some((c) => c.description.toLowerCase().includes(v)))
      return { success: true, reason: `value "${plan.value}" found` };
    return { success: false, reason: `typed text not visible after act` };
  }
  if (afterCandidates.length > 0) {
    return { success: true, reason: 'action performed, page stable' };
  }
  return { success: false, reason: 'page lost all controls after act' };
}

export type VerifyResult = {
  success: boolean;
  reason: string;
  goalDone: boolean;
  next?: string;
};

/** Real judge: this step + the ORIGINAL goal. Names the next step when unfinished. */
async function verify(
  transcript: string,
  plan: Plan,
  acted: Candidate,
  beforeUrl: string,
  afterUrl: string,
  beforeCandidates: Candidate[],
  afterCandidates: Candidate[],
  goal?: { goal: string; history: string[] },
): Promise<VerifyResult> {
  const short = (cs: Candidate[]) =>
    cs.slice(0, 30).map((c) => ({ id: c.id, description: c.description }));
  const goalLine = goal
    ? `\nOriginal goal: "${goal.goal}"\nSteps done so far: ${goal.history.length ? goal.history.join(' → ') : '(none yet — this was the first step)'}\n`
    : '';
  const system = `You are HandsFree verifier. Judge THIS step and the ORIGINAL goal. Return {"success":true/false,"reason":"<brief>","goalDone":true/false,"next":"<one concrete next action>"}.
- success: did this step work? Click-navigate ok if URL/content moved toward intent. Click without navigation ok if performed, no error visible. Fill ok only if the value (or its effect) shows afterwards. Error/login wall/captcha: success false. Unsure: success true.
- goalDone: is the ORIGINAL goal fully achieved now? Single-step intents: true when success. Multi-step ("search X and open first result"): false until every part is done.
- next: when goalDone is false, one concrete next action ("click the first result"). Omit when goalDone is true.`;
  const user =
    `${goalLine}Intent of this step: "${transcript}"\nAction taken: ${acted.method} on ${acted.description}` +
    (plan.value ? ` with value "${plan.value}"` : '') +
    `\nBefore URL: ${beforeUrl}\nAfter URL: ${afterUrl}` +
    `\nBefore controls:\n${JSON.stringify(short(beforeCandidates))}` +
    `\nAfter controls:\n${JSON.stringify(short(afterCandidates))}`;
  try {
    const text = await withTimeout(callLLM(system, user), 15000);
    const parsed = JSON.parse(text);
    const raw = parsed.success !== undefined ? parsed : (parsed.verdict ?? parsed);
    if (typeof raw.success !== 'boolean' || typeof raw.reason !== 'string')
      throw new Error('bad verifier shape');
    return {
      success: raw.success,
      reason: raw.reason,
      goalDone: raw.goalDone ?? true,
      next: typeof raw.next === 'string' && raw.next.trim() ? raw.next.trim() : undefined,
    };
  } catch {
    const fb = fallbackVerify(plan, beforeUrl, afterUrl, afterCandidates);
    return { ...fb, goalDone: true };
  }
}

export type StepResult = { ok: boolean; goalDone: boolean; next?: string; summary: string };

const MAX_STEPS = 5;

/** Bounded multi-step loop: one goal, up to 5 observe→plan→act→verify rounds. */
async function runCommand(transcript: string, signal: AbortSignal): Promise<void> {
  try {
    const goal = transcript;
    const history: string[] = [];
    let current = transcript;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const res = await runCommandInner(current, signal, { goal, history, step });
      if (!res.ok) return;
      history.push(res.summary);
      if (res.goalDone || !res.next || step === MAX_STEPS - 1) {
        if (step > 0) {
          const tabId = await getActiveTabId();
          if (tabId) {
            await updateHud(tabId, {
              status: 'Done',
              verification: `✓ done in ${step + 1} steps — ${res.summary}`,
              thought: history.join(' → '),
              thinking: false,
              showStop: false,
            });
          }
        }
        return;
      }
      current = res.next;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[command] failed:', msg);
    const tabId = await getActiveTabId();
    if (tabId) {
      await updateHud(tabId, {
        status: 'Failed',
        verification: `Failed: ${msg} — try rephrasing`,
        thought: msg,
        thinking: false,
        showStop: false,
      });
    }
  }
}

async function runCommandInner(
  transcript: string,
  signal: AbortSignal,
  optic?: { goal: string; history: string[]; step: number },
): Promise<StepResult> {
  const step = optic?.step ?? 0;
  const tag = step > 0 ? `Step ${step + 1} — ` : '';
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = activeTab?.id ?? null;
  if (!tabId) throw new Error('no active tab');
  let beforeUrl = activeTab.url ?? '';
  const pageCtx: PageCtx = {
    tabId,
    url: activeTab.url ?? '',
    title: (activeTab.title ?? '').slice(0, 80),
  };

  await updateHud(tabId, {
    transcript: step === 0 ? transcript : undefined,
    isFinal: true,
    status: `${tag}Observing...`,
    thought: 'scanning controls…',
    thinking: true,
  });

  // universal navigation: "open X" lands on the site first, then acts.
  // direct URLs cost zero model calls; names cost one tiny resolve call.
  const nav = extractNavIntent(transcript);
  if (nav) {
    await updateHud(tabId, {
      status: `${tag}Opening ${nav.target}…`,
      thought: 'resolving address…',
      thinking: true,
    });
    const opened = await openSite(tabId, nav.target, signal);
    beforeUrl = opened.url;
    if (!nav.rest) {
      await updateHud(tabId, {
        status: step > 0 ? `${tag}Verified` : 'Verified',
        verification: `✓ opened ${opened.url}`,
        thought: opened.url,
        thinking: false,
        showStop: false,
      });
      return { ok: true, goalDone: true, next: undefined, summary: `opened ${opened.url}` };
    }
    transcript = nav.rest;
  }
  let retries = 0;
  while (retries <= 2) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    let candidates = await observe(tabId);
    if (!candidates.length) throw new Error('no candidates');

    // scroll-to-discover: nothing relevant in view? look further down (max 3).
    let best = rankCandidates(transcript, candidates).best;
    let scrolls = 0;
    while (best < 3 && scrolls < 3) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await scrollPage(tabId);
      await new Promise((r) => setTimeout(r, 300));
      const more = await observe(tabId);
      if (!more.length) break;
      const rescored = rankCandidates(transcript, more).best;
      if (rescored <= best) break;
      candidates = more;
      best = rescored;
      scrolls++;
    }
    if (scrolls > 0) console.log(`[command] discover: ${scrolls} scrolls, best score ${best}`);
    const { ranked: topRanked } = rankCandidates(transcript, candidates);
    await updateHud(tabId, {
      plan: `Found ${candidates.length}`,
      status: 'Planning...',
      thought: `${candidates.length} controls · top match ${topRanked[0]?.description ?? '—'}`,
      thinking: true,
    });
    let plan: Plan;
    try {
      plan = await planWithLLM(transcript, candidates, pageCtx);
    } catch {
      await updateHud(tabId, { thinking: false }).catch(() => {});
      plan = fallbackPlan(transcript, candidates);
    }
    const candidate = candidates[plan.index];
    const preCandidates = candidates;
    await updateHud(tabId, {
      plan: `→ ${candidate.description} — ${plan.reasoning}`,
      status: 'Acting...',
      thought: plan.reasoning,
      thinking: false,
    });
    await highlight(tabId, candidate.selector);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await act(tabId, candidate, plan.value);

    // chained submit: fill AND post in one command.
    // Enter first (submits nearly every search box), button click as fallback
    // (comment boxes need the Comment/Post button — Enter just adds a newline).
    const filled = plan.value !== undefined || candidate.method === 'fill';
    if (filled && /comment|post|send|search|submit|publish/i.test(transcript)) {
      try {
        let submitted = false;
        if (!/comment|post|publish/i.test(transcript)) {
          await pressEnter(tabId, candidate.selector);
          await new Promise((r) => setTimeout(r, 700));
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          try {
            const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
            submitted = (t.url ?? beforeUrl) !== beforeUrl;
          } catch {
            submitted = false;
          }
          if (submitted) {
            await updateHud(tabId, {
              plan: '→ submitted with Enter',
              status: 'Verifying...',
              working: true,
            });
          }
        }
        if (!submitted) {
          const again = await observe(tabId);
          // heuristic first: buttons name themselves — no LLM roundtrip needed.
          // LLM only as fallback when nothing scores like a submit button.
          const submitRanked = rankCandidates(
            'submit post comment publish search send button',
            again,
            true,
          );
          let submitTarget = submitRanked.best >= 4 ? submitRanked.ranked[0] : null;
          let submitReason = submitTarget ? `button match (score ${submitRanked.best})` : '';
          if (!submitTarget) {
            const submit = await planWithLLM(
              `click the submit/post/search button to complete: "${transcript}" (no text to type, omit value)`,
              again,
              pageCtx,
            );
            submitTarget = again[submit.index];
            submitReason = submit.reasoning;
          }
          await updateHud(tabId, {
            plan: `→ ${submitTarget.description} — ${submitReason || 'posting…'}`,
            status: 'Acting...',
            thought: submitReason || 'posting…',
            thinking: false,
            working: true,
          });
          await highlight(tabId, submitTarget.selector);
          if (!signal.aborted) await act(tabId, submitTarget);
        }
      } catch (e) {
        console.warn('[command] chained submit skipped', e);
      }
    }

    await updateHud(tabId, {
      status: 'Verifying...',
      thought: 'checking result…',
      thinking: true,
    });
    await new Promise((r) => setTimeout(r, 400));
    const afterCandidates = await observe(tabId);
    let afterUrl = beforeUrl;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      afterUrl = tab.url ?? beforeUrl;
    } catch {}
    const result = await verify(
      transcript,
      plan,
      candidate,
      beforeUrl,
      afterUrl,
      preCandidates,
      afterCandidates,
      optic ? { goal: optic.goal, history: optic.history } : undefined,
    );
    const summary = `${candidate.description}`;
    if (result.success) {
      await updateHud(tabId, {
        verification: `✓ ${result.reason}`,
        status: step > 0 ? `${tag}Verified` : 'Verified',
        thought: result.reason,
        thinking: false,
        showStop: false,
      });
      return { ok: true, goalDone: result.goalDone, next: result.next, summary };
    }
    if (retries === 2) {
      await updateHud(tabId, {
        verification: `Need help: ${result.reason}`,
        status: 'Need help',
        thinking: false,
        showStop: false,
      });
      return { ok: false, goalDone: true, summary };
    }
    await updateHud(tabId, {
      verification: `↻ ${result.reason}`,
      status: `Retrying ${retries + 1}/2`,
    });
    beforeUrl = afterUrl;
    retries++;
  }
  // unreachable — every path inside the loop returns — but TypeScript insists
  return { ok: false, goalDone: true, summary: 'exhausted retries' };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'hud') {
      const tabId = await getActiveTabId();
      if (tabId) await updateHud(tabId, msg.update);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'hello') {
      const data = (await chrome.storage.local
        .get(['apiKey', 'AISTUDIO_API_KEY'])
        .catch(() => ({}))) as any;
      sendResponse({ hasKey: !!(data.apiKey || data.AISTUDIO_API_KEY) });
      return;
    }
    if (msg.type === 'speech' && msg.isFinal && msg.text) {
      const text: string = msg.text.trim();
      if (!text) return;
      // interrupt handling
      const isStop = /\b(stop|cancel|wait|hold on|abort)\b/i.test(text);
      if (isStop) {
        const m = text.match(/actually[,:]?\s*(.+)/i);
        const newIntent = m
          ? m[1].trim()
          : text
              .replace(/\b(stop|cancel|wait|hold on|abort)\b/gi, '')
              .replace(/[—\-:,]+/g, ' ')
              .trim();
        (runningController ?? currentAbort).abort();
        queue.length = 0;
        // fresh controller — the old signal stays aborted forever
        currentAbort = new AbortController();
        const freshSignal = currentAbort.signal;
        const tabId = await getActiveTabId();
        if (tabId)
          await updateHud(tabId, {
            status: 'Interrupted',
            verification: 'Stopped',
            showStop: false,
          });
        if (!newIntent || newIntent.length < 3) {
          sendResponse({ interrupted: true });
          return;
        }
        // enqueue new intent on the fresh signal, not the aborted one
        queue.push({
          run: () => runCommand(newIntent, freshSignal).catch(() => {}),
          controller: currentAbort,
        });
      } else {
        currentAbort = new AbortController();
        const signal = currentAbort.signal;
        const controller = currentAbort;
        // errors already surface on the pill via runCommand's boundary — stay silent here
        queue.push({ run: () => runCommand(text, signal).catch(() => {}), controller });
      }
      if (!running) {
        running = true;
        try {
          while (queue.length) {
            const item = queue.shift()!;
            runningController = item.controller;
            try {
              await item.run();
            } finally {
              runningController = null;
            }
          }
        } finally {
          running = false;
        }
      }
      sendResponse({ ok: true });
    }
  })();
  return true;
});
