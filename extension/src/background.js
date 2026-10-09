/**
 * HandsFree — MV3 background service worker.
 * Owns the serial queue, interrupts, and message routing.
 * Thinking lives in loop.ts (ReAct); hands live in tools.ts.
 */
import { runGoal } from './loop.js';
import { updateHud } from './hud.js';
import { validateKey } from './llm.js';
const queue = [];
let running = false;
let currentAbort = new AbortController();
// the controller of the command actually executing — "stop" aborts THIS,
// not whatever controller was created last
let runningController = null;
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
/** Thin boundary: failures surface on the pill, aborts stay silent. */
async function runCommand(transcript, signal) {
  try {
    const tabId = await getActiveTabId();
    if (!tabId) throw new Error('no active tab');
    await runGoal(transcript, tabId, signal);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[command] failed:', msg);
    const tabId = await getActiveTabId();
    if (tabId) {
      await updateHud(tabId, {
        status: 'Failed',
        verification: `Failed: ${msg} — try rephrasing`,
        thought: String(msg).slice(0, 160),
        thinking: false,
        showStop: false,
      });
    }
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
    if (msg.type === 'hello') {
      const data = await chrome.storage.local
        .get(['apiKey', 'AISTUDIO_API_KEY', 'hfKeyOk'])
        .catch(() => ({}));
      const hasKey = !!(data.apiKey || data.AISTUDIO_API_KEY);
      // first contact with a saved-but-unverified key: probe once, cache it.
      // a dead key is the classic cause of "always planning, never doing".
      let keyOk = data.hfKeyOk === true ? true : undefined;
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
            const item = queue.shift();
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
