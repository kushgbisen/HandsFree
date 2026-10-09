/**
 * Offscreen document — Web Speech API must run here, not in service worker
 */
const port = chrome.runtime.connect({ name: 'keepalive' });
port.onDisconnect.addListener(() =>
  setTimeout(() => chrome.runtime.connect({ name: 'keepalive' }), 1000),
);

const SR: any = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
let rec: any = null;
let listening = false;
let starting = false;

function say(text: string) {
  chrome.runtime.sendMessage({ type: 'hud', update: { status: text } }).catch(() => {});
}

function startRec(r: any) {
  if (starting) return;
  try {
    starting = true;
    r.start();
  } catch (e) {
    starting = false;
    say('Mic failed: ' + (e instanceof Error ? e.message : String(e)));
  }
}

function ensureRec(): any {
  if (rec) return rec;
  if (!SR) {
    say('Voice needs Chrome desktop — type in the pill instead');
    return null;
  }
  rec = new SR();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';
  rec.onstart = () => {
    starting = false;
    listening = true;
    chrome.runtime
      .sendMessage({ type: 'hud', update: { status: 'Listening…', showMic: true } })
      .catch(() => {});
  };
  rec.onend = () => {
    starting = false;
    listening = false;
    chrome.runtime
      .sendMessage({ type: 'hud', update: { status: 'Idle', showMic: false } })
      .catch(() => {});
  };
  rec.onerror = (e: any) => {
    const err = e.error || 'unknown';
    const help =
      err === 'not-allowed' || err === 'service-not-allowed'
        ? ' — mic blocked for the extension. Open the pill on a normal tab, click the mic, and Allow when asked. Or type instead.'
        : err === 'no-speech'
          ? ' — nothing heard. Speak closer or type instead.'
          : err === 'audio-capture'
            ? ' — no microphone found. Plug one in or type instead.'
            : ' — try again or type instead.';
    say('Mic error: ' + err + help);
  };
  rec.onresult = (e: any) => {
    const r = e.results[e.results.length - 1];
    const text: string = r[0].transcript;
    const isFinal: boolean = r.isFinal;
    // live words getting written as you speak — interim only, final handled by background bubble
    if (!isFinal) {
      chrome.runtime
        .sendMessage({ type: 'hud', update: { transcript: text, isFinal: false } })
        .catch(() => {});
    } else if (text.trim()) {
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
    else startRec(r);
  }
  if (msg.type === 'startMic') {
    const r = ensureRec();
    if (r) startRec(r);
  }
});
