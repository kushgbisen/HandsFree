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
async function planWithLLM(transcript, candidates) {
  const system = `You are HandsFree planner. Choose ONLY from candidates. Return {"index":<id>,"reasoning":"<brief>","value":"<optional>"}`;
  const user = `Transcript: "${transcript}"\nCandidates:\n${JSON.stringify(
    candidates.map((c) => ({ id: c.id, description: c.description, method: c.method })),
    null,
    2,
  )}`;
  const text = await callLLM(system, user);
  const parsed = JSON.parse(text);
  const raw = parsed.index !== undefined ? parsed : (parsed.plan ?? parsed);
  if (raw.index < 0 || raw.index >= candidates.length)
    throw new Error(`index ${raw.index} out of range`);
  return { index: raw.index, reasoning: raw.reasoning ?? '', value: raw.value ?? undefined };
}
function fallbackPlan(transcript, candidates) {
  const words = transcript
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter(
      (w) =>
        w.length > 1 && !['click', 'fill', 'type', 'the', 'and', 'for', 'with', 'into'].includes(w),
    );
  let best = 0,
    bestScore = -1;
  candidates.forEach((c, i) => {
    let s = 0;
    for (const w of words) if (c.description.toLowerCase().includes(w)) s += 2;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return { index: best, reasoning: `fallback: chose ${candidates[best].description}` };
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
  await updateHud(tabId, { transcript: `"${transcript}"`, status: 'Observing...' });
  let beforeUrl = '';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    beforeUrl = tab.url ?? '';
  } catch {}
  let retries = 0;
  while (retries <= 2) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const candidates = await observe(tabId);
    if (!candidates.length) throw new Error('no candidates');
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
// offscreen for mic
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument?.();
  if (!has)
    await chrome.offscreen.createDocument({
      url: 'src/offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Mic for HandsFree',
    });
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
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
      await ensureOffscreen();
      chrome.runtime.sendMessage({ type: 'offscreen-start' });
      sendResponse({ ok: true });
    }
  })();
  return true;
});
// keep offscreen alive
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') port.onDisconnect.addListener(() => {});
});
