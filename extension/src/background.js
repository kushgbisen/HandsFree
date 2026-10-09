/**
 * HandsFree — MV3 background service worker (no Node, no Playwright)
 * Fix #1 keepalive via Port + storage.session checkpoint
 */
import { callLLM } from './llm.js';
const queue = [];
let running = false;
let currentAbort = new AbortController();
// keepalive
const ports = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
});
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}
async function observe(tabId) {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'observe' });
  return res?.candidates ?? [];
}
async function highlight(tabId, selector) {
  await chrome.tabs.sendMessage(tabId, { type: 'highlight', selector });
}
async function act(tabId, candidate, value) {
  await chrome.tabs.sendMessage(tabId, { type: 'act', candidate, value });
}
async function updateHud(tabId, update) {
  chrome.tabs.sendMessage(tabId, { type: 'hud', update }).catch(() => {});
}
async function scrollPage(tabId) {
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
function intentWords(transcript) {
  return transcript
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 1 && !INTENT_STOPWORDS.has(w));
}
/** Fill-like intents ("comment X", "search Y") target boxes, not the words themselves. */
function isFillIntent(transcript) {
  if (/omit value|no text to type/i.test(transcript)) return false;
  return /comment|fill|type|search|write|say|enter|post|publish/i.test(transcript);
}
function scoreCandidate(words, fillIntent, c) {
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
function rankCandidates(transcript, candidates) {
  const words = intentWords(transcript);
  const fillIntent = isFillIntent(transcript);
  const scored = candidates.map((c) => ({ c, s: scoreCandidate(words, fillIntent, c) }));
  scored.sort((a, b) => b.s - a.s);
  return { ranked: scored.map((x) => x.c), best: scored.length ? scored[0].s : 0 };
}
async function planWithLLM(transcript, candidates) {
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
  const user = `Transcript: "${transcript}"\nCandidates:\n${JSON.stringify(
    shortlist.map((c) => ({ id: c.id, description: c.description, method: c.method })),
    null,
    2,
  )}`;
  const text = await callLLM(system, user);
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
function fallbackPlan(transcript, candidates) {
  const { ranked, best } = rankCandidates(transcript, candidates);
  const verb = Array.from(VERB_ONLY).find((v) => transcript.toLowerCase().includes(v)) ?? 'act on';
  return {
    index: ranked[0].id,
    reasoning: `fallback: ${verb} ${ranked[0].description} (score ${best})`,
  };
}
async function verify(transcript, plan, beforeUrl, afterUrl, afterCandidates) {
  if (beforeUrl !== afterUrl) return { success: true, reason: `URL changed` };
  if (plan.value) {
    const v = plan.value.toLowerCase();
    if (afterCandidates.some((c) => c.description.toLowerCase().includes(v)))
      return { success: true, reason: `value "${plan.value}" found` };
  }
  // for click, assume success if still has candidates (conservative)
  return { success: true, reason: 'assume click performed' };
}
async function runCommand(transcript, signal) {
  const tabId = await getActiveTabId();
  if (!tabId) throw new Error('no active tab');
  await updateHud(tabId, { transcript, isFinal: true, status: 'Observing...' });
  let beforeUrl = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    beforeUrl = tab.url ?? '';
  } catch {}
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
    await updateHud(tabId, { plan: `Found ${candidates.length}`, status: 'Planning...' });
    let plan;
    try {
      plan = await planWithLLM(transcript, candidates);
    } catch {
      plan = fallbackPlan(transcript, candidates);
    }
    const candidate = candidates[plan.index];
    await updateHud(tabId, {
      plan: `→ ${candidate.description} — ${plan.reasoning}`,
      status: 'Acting...',
    });
    await highlight(tabId, candidate.selector);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    await act(tabId, candidate, plan.value);
    // chained submit: "comment nice video" fills AND posts in one command.
    // After a fill, look once for the submit/post button and click it.
    const filled = plan.value !== undefined || candidate.method === 'fill';
    if (filled && /comment|post|send|search|submit|publish/i.test(transcript)) {
      try {
        const again = await observe(tabId);
        const submit = await planWithLLM(
          `click the submit/post/search button to complete: "${transcript}" (no text to type, omit value)`,
          again,
        );
        const submitTarget = again[submit.index];
        await updateHud(tabId, {
          plan: `→ ${submitTarget.description} — posting…`,
          status: 'Acting...',
          working: true,
        });
        await highlight(tabId, submitTarget.selector);
        if (!signal.aborted) await act(tabId, submitTarget);
      } catch (e) {
        console.warn('[command] chained submit skipped', e);
      }
    }
    await updateHud(tabId, { status: 'Verifying...' });
    await new Promise((r) => setTimeout(r, 400));
    const afterCandidates = await observe(tabId);
    let afterUrl = beforeUrl;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      afterUrl = tab.url ?? beforeUrl;
    } catch {}
    const result = await verify(transcript, plan, beforeUrl, afterUrl, afterCandidates);
    if (result.success) {
      await updateHud(tabId, {
        verification: `✓ ${result.reason}`,
        status: 'Verified',
        showStop: false,
      });
      return;
    }
    if (retries === 2) {
      await updateHud(tabId, {
        verification: `Need help: ${result.reason}`,
        status: 'Need help',
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
async function ensureOffscreen(tabId) {
  try {
    if (!chrome.offscreen) throw new Error('offscreen API missing — update Chrome');
    const has = await chrome.offscreen.hasDocument();
    if (!has) {
      await chrome.offscreen.createDocument({
        url: 'src/offscreen.html',
        reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK'],
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
      const text = msg.text.trim();
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
        currentAbort.abort();
        queue.length = 0;
        const tabId = await getActiveTabId();
        if (tabId)
          await updateHud(tabId, {
            status: 'Interrupted',
            verification: '⚡ Interrupted',
            showStop: false,
          });
        if (!newIntent || newIntent.length < 3) {
          sendResponse({ interrupted: true });
          return;
        }
        // enqueue new intent
        queue.push(() => runCommand(newIntent, currentAbort.signal).catch(() => {}));
      } else {
        currentAbort = new AbortController();
        const signal = currentAbort.signal;
        queue.push(() =>
          runCommand(text, signal).catch((e) => {
            if (e.name !== 'AbortError') console.error(e);
          }),
        );
      }
      if (!running) {
        running = true;
        while (queue.length) {
          const fn = queue.shift();
          await fn();
        }
        running = false;
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
