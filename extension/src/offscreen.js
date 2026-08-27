'use strict';
/**
 * Offscreen document — Web Speech API must run here, not in service worker
 */
const port = chrome.runtime.connect({ name: 'keepalive' });
port.onDisconnect.addListener(() =>
  setTimeout(() => chrome.runtime.connect({ name: 'keepalive' }), 1000),
);
const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
let rec = null;
let listening = false;
function ensureRec() {
  if (rec) return rec;
  if (!SR) return null;
  rec = new SR();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';
  rec.onstart = () => {
    listening = true;
    chrome.runtime
      .sendMessage({ type: 'hud', update: { status: 'Listening…', showMic: true } })
      .catch(() => {});
  };
  rec.onend = () => {
    listening = false;
    chrome.runtime
      .sendMessage({ type: 'hud', update: { status: 'Idle', showMic: false } })
      .catch(() => {});
  };
  rec.onerror = (e) =>
    chrome.runtime
      .sendMessage({ type: 'hud', update: { status: 'Mic error: ' + (e.error || 'unknown') } })
      .catch(() => {});
  rec.onresult = (e) => {
    const r = e.results[e.results.length - 1];
    const text = r[0].transcript;
    const isFinal = r.isFinal;
    // show live words
    chrome.runtime.sendMessage({ type: 'hud', update: { transcript: text } }).catch(() => {});
    if (isFinal && text.trim()) {
      chrome.runtime.sendMessage({ type: 'speech', text: text.trim(), isFinal: true });
    }
  };
  return rec;
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'offscreen-start') {
    const r = ensureRec();
    if (!r) return;
    if (listening) r.stop();
    else r.start();
  }
  if (msg.type === 'startMic') {
    const r = ensureRec();
    if (r) r.start();
  }
});
