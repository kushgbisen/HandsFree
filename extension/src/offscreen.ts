/**
 * Offscreen document — only place where webkitSpeechRecognition can run in MV3
 * Service workers have no DOM, so this is the standard correct pattern.
 * Also holds keepalive Port to background (fix #1).
 */

const port = chrome.runtime.connect({ name: 'keepalive' });

const SR: any = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
let rec: any = null;

if (SR) {
  rec = new SR();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';
  rec.onresult = (e: any) => {
    const r = e.results[e.results.length - 1];
    const text: string = r[0].transcript;
    const isFinal: boolean = r.isFinal;
    chrome.runtime.sendMessage({ type: 'speech', text, isFinal });
  };
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'startMic' && rec) rec.start();
  if (msg.type === 'stopMic' && rec) rec.stop();
});
