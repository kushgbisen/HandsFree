const el = document.getElementById('transcript');

export function renderTranscript(text: string, isFinal: boolean) {
  if (!el) return;
  el.textContent = text;
  el.style.opacity = isFinal ? '1' : '0.6';
}
