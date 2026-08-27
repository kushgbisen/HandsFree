/**
 * HandsFree — MV3 background service worker
 * Fix #1: Service worker ephemerality — keepalive via open Port + checkpoint to chrome.storage.session
 * PQueue + AbortController state is not kept only in memory.
 */

import PQueue from 'p-queue';

// keepalive: content + offscreen hold a Port open, Chrome won't kill us while Port is connected
const keepAlivePorts = new Set<chrome.runtime.Port>();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'keepalive') return;
  keepAlivePorts.add(port);
  port.onDisconnect.addListener(() => keepAlivePorts.delete(port));
});

// also ping via offscreen/content every 20s as fallback
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ping') sendResponse({ alive: true });
  return false;
});

const queue = new PQueue({ concurrency: 1 });
const currentAbort = new AbortController();

// checkpoint queue to storage.session so a restart can resume
async function checkpoint() {
  try {
    await chrome.storage.session.set({
      hf_queue_len: queue.size,
      hf_pending: queue.pending,
    });
  } catch {}
}
queue.on('active', checkpoint);
queue.on('idle', checkpoint);
queue.on('completed', checkpoint);

// restore on restart
chrome.runtime.onStartup.addListener(async () => {
  const { hf_queue_len } = await chrome.storage.session.get('hf_queue_len');
  if (hf_queue_len) console.log('[background] restored queue len', hf_queue_len);
});

export { queue, currentAbort };
