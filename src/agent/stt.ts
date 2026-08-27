export type Transcript = {
  text: string;
  isFinal: boolean;
  confidence: number;
};

export interface STTProvider {
  start(): void;
  onTranscript(cb: (t: Transcript) => void): void;
  stop(): void;
}
