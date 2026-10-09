/**
 * HandsFree — MV3 background service worker.
 * Owns the serial queue, interrupts, and message routing.
 * Thinking lives in loop.ts (ReAct); hands live in tools.ts.
 */
import { runGoal } from './loop.js';
import { updateHud } from './hud.js';
import { transcribeAudio, validateKey } from './llm.js';

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

/** Drain the serial queue. Fire-and-forget — callers never block on it. */
function pumpQueue(): void {
  if (running) return;
  running = true;
  (async () => {
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
  })();
}

/** Thin boundary: failures surface on the pill, aborts stay silent. */
async function runCommand(
  transcript: string,
  signal: AbortSignal,
  tabHint: number | null,
): Promise<void> {
  try {
    const tabId = tabHint ?? (await getActiveTabId());
    if (!tabId) throw new Error('no active tab');
    await runGoal(transcript, tabId, signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[command] failed:', msg);
    const tabId = tabHint ?? (await getActiveTabId());
    if (tabId) {
      await updateHud(tabId, {
        status: 'Failed',
        verification: `Failed: ${msg} — try rephrasing`,
        thought: String(msg).slice(0, 160),
        thinking: false,
        showStop: false,
        working: false,
      });
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'hud') {
      const tabId = await getActiveTabId();
      if (tabId) await updateHud(tabId, msg.update);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'hello') {
      const data = (await chrome.storage.local
        .get(['apiKey', 'AISTUDIO_API_KEY', 'hfKeyOk'])
        .catch(() => ({}))) as any;
      const hasKey = !!(data.apiKey || data.AISTUDIO_API_KEY);
      // first contact with a saved-but-unverified key: probe once, cache it.
      // a dead key is the classic cause of "always planning, never doing".
      let keyOk: boolean | undefined = data.hfKeyOk === true ? true : undefined;
      if (hasKey && keyOk !== true) {
        try {
          await validateKey();
          await chrome.storage.local.set({ hfKeyOk: true });
          keyOk = true;
        } catch {
          keyOk = false;
        }
      }
      sendResponse({ hasKey, keyOk });
      return;
    }
    if (msg.type === 'speech' && msg.isFinal && msg.text) {
      const text: string = msg.text.trim();
      if (!text) {
        sendResponse({ ok: true });
        return;
      }
      // the tab that issued the command keeps it — switching tabs while the
      // agent thinks must never redirect the action to a different page
      const fromTab: number | null = sender?.tab?.id ?? null;
      // interrupt ONLY when the command leads with a stop phrase — "search
      // for wait times" or "cancel that comment later" are real commands
      const isStop = /^\s*(please\s+)?(stop|cancel|abort|wait|hold on|never ?mind)\b/i.test(text);
      if (isStop) {
        const m = text.match(/actually[,:]?\s*(.+)/i);
        const newIntent = m
          ? m[1].trim()
          : text
              .replace(/^\s*(please\s+)?(stop|cancel|abort|wait|hold on|never ?mind)\b/i, '')
              .replace(/[—\-:,]+/g, ' ')
              .trim();
        (runningController ?? currentAbort).abort();
        queue.length = 0;
        // fresh controller — the old signal stays aborted forever
        currentAbort = new AbortController();
        const freshSignal = currentAbort.signal;
        const tabId = fromTab ?? (await getActiveTabId());
        if (tabId)
          await updateHud(tabId, {
            status: 'Interrupted',
            verification: 'Stopped',
            showStop: false,
            working: false,
          });
        if (!newIntent || newIntent.length < 3) {
          sendResponse({ interrupted: true });
          return;
        }
        // enqueue new intent on the fresh signal, not the aborted one
        queue.push({
          run: () => runCommand(newIntent, freshSignal, fromTab).catch(() => {}),
          controller: currentAbort,
        });
      } else {
        currentAbort = new AbortController();
        const signal = currentAbort.signal;
        const controller = currentAbort;
        // errors already surface on the pill via runCommand's boundary — stay silent here
        queue.push({
          run: () => runCommand(text, signal, fromTab).catch(() => {}),
          controller,
        });
      }
      pumpQueue();
      sendResponse({ ok: true });
    }
    if (msg.type === 'speechAudio' && typeof msg.audio === 'string') {
      // second half of our own audio pipeline: transcribe, then run it as a
      // normal command on the tab that recorded it
      const fromTab: number | null = sender?.tab?.id ?? null;
      const audio = msg.audio as string;
      const mime = (msg.mime as string) || 'audio/webm';
      sendResponse({ ok: true });
      (async () => {
        const tabId = fromTab ?? (await getActiveTabId());
        const fail = (m: string) =>
          tabId
            ? updateHud(tabId, {
                status: 'Failed',
                verification: `Failed: ${m} — try again or type`,
                thought: m.slice(0, 160),
                thinking: false,
                showStop: false,
                working: false,
              })
            : Promise.resolve();
        try {
          if (tabId)
            await updateHud(tabId, {
              status: 'Transcribing…',
              thought: 'turning speech into text',
              thinking: true,
            });
          const text = (await transcribeAudio(audio, mime)).trim();
          if (text.length < 2) {
            await fail("didn't catch that — speak closer");
            return;
          }
          currentAbort = new AbortController();
          const signal = currentAbort.signal;
          const controller = currentAbort;
          queue.push({
            run: () => runCommand(text, signal, fromTab).catch(() => {}),
            controller,
          });
          pumpQueue();
        } catch (e) {
          console.error('[speechAudio] failed:', e);
          await fail(e instanceof Error ? e.message : String(e));
        }
      })();
      return;
    }
  })();
  return true;
});
