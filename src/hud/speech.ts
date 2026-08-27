// client-side only — Web Speech API lives in the browser, not Node
// simplest mic button + transcript, POSTs to server on final result

const micBtn = document.getElementById('micBtn') as HTMLButtonElement | null;
const transcriptEl = document.getElementById('transcript');
const statusEl = document.getElementById('status');

const SpeechRecognition =
  (window as unknown as { SpeechRecognition?: typeof webkitSpeechRecognition }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: typeof webkitSpeechRecognition })
    .webkitSpeechRecognition;

let recognition: webkitSpeechRecognition | null = null;
let listening = false;

function updateStatus(text: string) {
  if (statusEl) statusEl.textContent = text;
}

function initRecognition() {
  if (!SpeechRecognition) {
    updateStatus('Web Speech API not supported — use Chrome');
    if (micBtn) micBtn.disabled = true;
    return null;
  }

  const rec = new SpeechRecognition();
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onstart = () => {
    listening = true;
    if (micBtn) micBtn.textContent = '● Listening…';
    updateStatus('Listening…');
  };

  rec.onend = () => {
    listening = false;
    if (micBtn) micBtn.textContent = '🎤 Start mic';
    updateStatus('Idle — click mic and speak');
  };

  rec.onerror = (e: unknown) => {
    const err = e as { error?: string };
    updateStatus(`Error: ${err.error ?? 'unknown'}`);
  };

  rec.onresult = (e: SpeechRecognitionEvent) => {
    const result = e.results[e.results.length - 1];
    const text = result[0].transcript;
    if (transcriptEl) {
      transcriptEl.textContent = text;
      transcriptEl.style.opacity = result.isFinal ? '1' : '0.6';
    }

    if (result.isFinal && text.trim()) {
      updateStatus(`Heard: "${text.trim()}" — sending…`);
      fetch('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({}));
          updateStatus(data.message ?? 'Command sent');
        })
        .catch(() => updateStatus('Failed to send command'));
    }
  };

  return rec;
}

recognition = initRecognition();

micBtn?.addEventListener('click', () => {
  if (!recognition) return;
  if (listening) recognition.stop();
  else recognition.start();
});

// expose for console debugging
(window as unknown as { __recognition: unknown }).__recognition = recognition;

// --- types for browser Speech API ---
declare class webkitSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
}

type SpeechRecognitionEvent = Event & {
  results: SpeechRecognitionResultList;
  resultIndex: number;
};

type SpeechRecognitionResultList = {
  length: number;
  [index: number]: SpeechRecognitionResult;
};

type SpeechRecognitionResult = {
  length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
};

type SpeechRecognitionAlternative = {
  transcript: string;
  confidence: number;
};
