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

/** Real judge: compares before/after snapshots. Heuristics only on LLM failure. */
async function verify(
  transcript: string,
  plan: Plan,
  acted: Candidate,
  beforeUrl: string,
  afterUrl: string,
  beforeCandidates: Candidate[],
  afterCandidates: Candidate[],
): Promise<{ success: boolean; reason: string }> {
  const short = (cs: Candidate[]) =>
    cs.slice(0, 30).map((c) => ({ id: c.id, description: c.description }));
  const system = `You are HandsFree verifier. Decide if the user's intent was achieved. Return {"success":true/false,"reason":"<brief>"}.
- Click that navigates: success if the URL or content changed toward the intent.
- Click with no navigation expected: success if it was performed and no error is visible — do NOT fail just because the element still exists.
- Fill/type: success only if the typed value (or its effect) is visible afterwards.
- If an error, login wall, or captcha appeared: success false.
- When genuinely unsure, return success true — the user can interrupt.`;
  const user =
    `Intent: "${transcript}"\nAction taken: ${acted.method} on ${acted.description}` +
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
    return { success: raw.success, reason: raw.reason };
  } catch {
    return fallbackVerify(plan, beforeUrl, afterUrl, afterCandidates);
  }
}

async function runCommand(transcript: string, signal: AbortSignal): Promise<void> {
  try {
    await runCommandInner(transcript, signal);
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

async function runCommandInner(transcript: string, signal: AbortSignal): Promise<void> {
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
    transcript,
    isFinal: true,
    status: 'Observing...',
    thought: 'scanning controls…',
    thinking: true,
  });
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
    );
    if (result.success) {
      await updateHud(tabId, {
        verification: `✓ ${result.reason}`,
        status: 'Verified',
        thought: result.reason,
        thinking: false,
        showStop: false,
      });
      return;
    }
    if (retries === 2) {
      await updateHud(tabId, {
        verification: `Need help: ${result.reason}`,
        status: 'Need help',
        thinking: false,
        showStop: false,
      });
      return;
    }
    await updateHud(tabId, {
      verification: `↻ ${result.reason}`,
      status: `Retrying ${retries + 1}/2`,
    });
    beforeUrl = afterUrl;
    retries++;
  }
}

// offscreen for mic — every failure is reported to the pill, never silent
async function ensureOffscreen(tabId: number | null) {
  try {
    if (!chrome.offscreen) throw new Error('offscreen API missing — update Chrome');
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen.html',
        reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'] as any,
        justification: 'Microphone for HandsFree voice commands',
      });
      // let the document boot before messaging it
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (tabId) await updateHud(tabId, { status: `Mic setup failed: ${msg}` });
    throw e;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'hud') {
      const tabId = await getActiveTabId();
      if (tabId) await updateHud(tabId, msg.update);
      sendResponse({ ok: true });
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
    if (msg.type === 'startMic') {
      const tabId = await getActiveTabId();
      try {
        await ensureOffscreen(tabId);
      } catch {
        sendResponse({ ok: false });
        return;
      }
      // offscreen confirms by flipping the pill to Listening… (onstart)
      // or reports the exact error (onerror) — no silent hangs anymore
      chrome.runtime.sendMessage({ type: 'offscreen-start' });
      if (tabId) await updateHud(tabId, { status: 'Starting mic…' });
      sendResponse({ ok: true });
    }
  })();
  return true;
});

// keep offscreen alive
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') port.onDisconnect.addListener(() => {});
});
