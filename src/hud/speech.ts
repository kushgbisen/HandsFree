export type SpeechHandler = (text: string, isFinal: boolean) => void;

export function initSpeech(handler: SpeechHandler): void {
  const SpeechRecognition = (
    window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition }
  ).webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn('Web Speech API not supported');
    return;
  }

  const rec = new SpeechRecognition();
  // minimal continuous interim setup
  Object.assign(rec, { continuous: true, interimResults: true, lang: 'en-US' });

  rec.onresult = (e: SpeechRecognitionResultList | unknown) => {
    const results = e as SpeechRecognitionResultList;
    const last = results[results.length - 1];
    const transcript = last[0].transcript;
    handler(transcript, last.isFinal);
  };

  rec.start();
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((e: unknown) => void) | null;
}

type SpeechRecognitionResultList = SpeechRecognitionResult[] & { length: number };
type SpeechRecognitionResult = SpeechRecognitionAlternative[] & { isFinal: boolean };
type SpeechRecognitionAlternative = { transcript: string; confidence: number };
