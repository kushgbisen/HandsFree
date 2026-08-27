# HandsFree — Prototype Features (Ruthless MVP)

## Core Loop: Voice → Observe → Plan → Highlight → Act → Verify → Interrupt

Every feature exists to make the 5 demo moments land. Nothing else ships.

---

### F1: Voice Input — Web Speech API

**Status:** IN (MVP)

- `webkitSpeechRecognition` continuous + interimResults
- Interim (gray) + Final (white) transcript in HUD
- Push-to-talk fallback: hold `Space`
- Mic states: 🟢 Listening / 🔴 Muted / 🟡 Processing
- Output: `ws:voice { text, isFinal, confidence }`
- **Cut:** WebGPU Whisper (Phase 2 behind `STTProvider`)

### F2: HUD Overlay — In-Page (No Extension)

**Status:** IN (MVP)

- Injected via Playwright `addInitScript` → fixed bottom-right 320×400
- Shows: mic status, live transcript, plan reasoning, verification badge
- Big red `STOP` button + voice interrupt ("stop/cancel/wait")
- `z-index: 2147483647`, Shadow DOM isolation
- **Cut:** Extension popup/content script (Phase 2)

### F3: Observe — Stagehand `observe()`

**Status:** IN (MVP)

- Input: user intent string
- Output: `Candidate[] { selector, description, confidence }`
- Uses Stagehand AI observation, not manual selectors
- Re-observes after every act for verification

### F4: Plan — DeepSeek + Zod

**Status:** IN (MVP)

- System prompt + intent + candidates → DeepSeek Chat
- Zod schema: `ActionPlan { action: click|type|navigate|scroll|wait, target, selector?, value?, reasoning, confidence }`
- Temp 0.1, retry once on Zod parse fail
- If confidence <0.6 → `wait` + re-observe
- **Cut:** Local LLM / Ollama (Phase 2)

### F5: Act + Highlight — The Theater

**Status:** IN (MVP)

- `injectHighlight(selector)` → yellow pulse 600ms → `act(plan)`
- CSS: `outline: 3px solid #facc15` + pulse animation
- 600ms pause IS the feature — lets judges see "thinking"
- Actions: click, type, navigate, scroll

### F6: Interrupt — p-queue + AbortController

**Status:** IN (MVP) — **This is your wow moment**

- `p-queue` concurrency 1, `AbortController` per task
- New `voice:final` with "stop/cancel/wait/hold on" → `abort()` + `queue.clear()` in <500ms
- Also: "actually..." → abort + re-plan with new intent
- Every `await` in loop checks `signal.aborted`

### F7: Verify & Retry

**Status:** IN (MVP)

- After act: capture `page.content()` → DeepSeek judge: `{ success: boolean, reason }`
- HUD: `Verifying... → ✓ Verified` or `↻ Retrying (1/2)`
- Max 2 retries, then "Need help — click to take over"
- Prevents silent wrong-click failures

### F8: Express Server — Single Process

**Status:** IN (MVP)

- One `server.ts`: Express static + `ws` + Playwright lifecycle
- Routes: `/hud`, `ws:voice`, `ws:agent`
- One command: `npm run dev` (or `npm run demo`)
- **Cut:** Native Messaging host, companion binary

---

## Explicitly CUT (Not MVP)

| Feature                        | Why Cut                               | Returns When                        |
| ------------------------------ | ------------------------------------- | ----------------------------------- |
| Chrome Extension (manifest v3) | Module loading/CSP risk               | Phase 2: same HUD as content script |
| Native Companion App           | OS permissions, stdio bridge          | Phase 2: for file/OS actions        |
| WebGPU Whisper                 | 400MB, WASM threads, 5-15s cold start | Phase 2: behind `STTProvider`       |
| Offline Mode                   | Needs local STT + local LLM           | Phase 2                             |
| Multi-tab orchestration        | Flaky, not needed for demo            | Phase 2                             |
| Auth / Gmail / Notion targets  | Anti-automation, dynamic DOM          | Phase 2: generic handling           |
| Session replay / memory        | Not a demo moment                     | Phase 2                             |

---

## Interfaces to Protect (Makes Phase 2 a swap, not rewrite)

```typescript
interface STTProvider {
  start(): void;
  onTranscript(cb: (t: Transcript) => void): void;
  stop(): void;
}

interface Planner {
  plan(intent: string, candidates: Candidate[]): Promise<ActionPlan>;
}

type AgentEvent =
  | { type: 'voice:final'; text: string }
  | { type: 'agent:observing' }
  | { type: 'agent:plan'; plan: ActionPlan }
  | { type: 'agent:acting'; selector: string }
  | { type: 'agent:verifying' }
  | { type: 'agent:verified'; success: boolean; reason: string }
  | { type: 'agent:interrupted' };
```

---

## Demo Acceptance Criteria

- [ ] M1 Voice→Intent: interim transcript <100ms, final <300ms
- [ ] M2 Observe→Plan: HUD shows reasoning, Zod-valid JSON 10/10
- [ ] M3 Highlight→Act: yellow pulse visible from back of room, then click
- [ ] M4 Interrupt: voice "stop" aborts in <500ms, re-plans
- [ ] M5 Verify: auto-detects success/failure, retries max 2×
- [ ] E2E: HN flow works 2/3 rehearsals, interrupt 3/3
- [ ] One command: `npm install && npm run dev` on fresh clone
