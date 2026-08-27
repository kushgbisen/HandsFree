# HandsFree — 2-Day Ruthless Prototype Plan

### Build the smallest thing that produces every demo moment

> **North Star:** A judge should see a real Chrome window, hear a human voice, see the agent _think → act → verify_ live with visual highlights, and be able to interrupt it mid-task. If all 5 moments land, you win — no matter how "thin" the architecture is.

---

## 1. THE ONE BIG CALL

**CUT for prototype (reintroduce in Phase 2):**

- ❌ Chrome Extension (manifest v3, content scripts, module loading)
- ❌ Native Companion App + Native Messaging bridge
- ❌ Local WebGPU Whisper (large model download, WASM threading, device variance)
- ❌ Offline mode

**USE instead:**

- ✅ Single Node.js process + Playwright/Stagehand controlling a _visible_ Chrome window
- ✅ Browser Web Speech API (`webkitSpeechRecognition`) — zero-install, near-instant, works in any Chrome tab
- ✅ DeepSeek (cloud) + Zod for observe→plan

**Why:** Those three cuts remove ~70% of your integration risk while removing 0% of your demo wow-factor. Judges don't care _how_ audio got transcribed; they care that you said "book me a flight" and the browser _did it_ live and interruptibly.

```
PITCH DECK ARCHITECTURE (Phase 2)        RUTHLESS PROTOTYPE (Day 1-2)
┌─────────┐  nativeMessaging  ┌────────┐   ┌─────────────────────────────────┐
│Extension│◄─────────────────►│ Native │   │  Single Node.js Process         │
│  (HUD)  │                   │  App   │   │  ┌──────┐  ┌──────┐  ┌───────┐ │
└────┬────┘                   └───┬────┘   │  │Express│  │ Stage│  │DeepSeek│ │
     │ CDP                        │ STT    │  │ Server│◄►│hand  │◄►│ + Zod │ │
     ▼                            ▼        │  │+ HUD  │  │/Play │  │       │ │
┌──────────┐  ┌──────────────┐            │  └───┬───┘  └──┬───┘  └───┬───┘ │
│ Chrome   │  │WebGPU Whisper│            │      │         │          │     │
│  Tabs    │  │  (local)     │            │      └────►┌───▼────────┐ │     │
└──────────┘  └──────────────┘            │            │Playwright│◄┘     │
                                          │            │(visible) │        │
                                          │            └──────────┘        │
                                          │   Web Speech API (browser tab)  │
                                          └─────────────────────────────────┘
                                          One process. One window. Zero bridges.
```

---

## 2. DEMO MOMENTS — THE ONLY 5 THINGS THAT MATTER

If these 5 work reliably, nothing else matters. Everything in this plan serves _only_ these.

| #      | Moment                                  | What Judge Sees                                                                          | What Must Actually Work                                                             |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **M1** | **Voice → Intent**                      | You speak: _"Go to Hacker News and open the top story"_ → text appears instantly in HUD  | Web Speech API captures audio, streams transcript to HUD, emits `voice:final` event |
| **M2** | **Observe → Plan (The "Brain" Moment)** | HUD shows: `OBSERVING... → Found 23 candidates → PLAN: click [Hacker News link]`         | DeepSeek + Zod returns structured `ActionPlan` JSON; HUD renders reasoning          |
| **M3** | **Act with Visual Proof**               | Browser highlights the target in yellow, then clicks. Page navigates _live_              | Stagehand `observe()` + `act()` + injected highlight CSS                            |
| **M4** | **Live Interrupt**                      | Mid-task you say _"Stop — actually search for AI news instead"_ → agent stops, re-plans  | `AbortController` cancels p-queue, new voice input preempts current plan            |
| **M5** | **Verify & Recover**                    | Agent checks "did I land on the right page?" — if not, retries once with new observation | Verification loop: screenshot/DOM check → DeepSeek judge → retry (max 2)            |

**Anti-goals for demo:** Do NOT try to show multi-tab orchestration, auth flows, file downloads, or offline. One site (Hacker News / one rehearsed target app) is enough.

---

## 3. SCOPE MATRIX

### ✅ IN — Must Ship in 48h

| Feature                | Detail                                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Voice Input**        | Web Speech API continuous mode, interim + final results, push-to-talk fallback (hold `Space`)                         |
| **HUD Overlay**        | Floating panel _inside_ the Playwright page (not extension) — shows transcript, plan, status, and interrupt button    |
| **Observe**            | Stagehand `page.observe("find the main headline link")` → returns candidates with selector + description              |
| **Plan**               | DeepSeek call with Zod-validated output: `{ action: "click" \| "type" \| "navigate", target, reasoning, confidence }` |
| **Act**                | Stagehand `page.act(plan)` + CSS highlight injection (`outline: 3px solid #facc15; transition`)                       |
| **Interrupt**          | `AbortController` + `p-queue` (concurrency 1) — new voice intent aborts current task queue                            |
| **Verify**             | After act, re-observe page → DeepSeek `didTaskSucceed?` → retry or mark done                                          |
| **Express Server**     | Single `server.ts` serves HUD assets, WebSocket for voice→agent messages, controls Playwright lifecycle               |
| **One Rehearsed Flow** | E2E script: voice → HN → open article → search → interrupt → new task                                                 |

### ❌ OUT — Explicitly Cut

| Cut                                 | Why                                                           | When It Returns                                                        |
| ----------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Chrome Extension + Content Scripts  | Module loading edge cases, store review, CSP issues           | Phase 2: wrap Playwright logic into extension after loop is proven     |
| Native Messaging Host               | Binary install, OS permissions, stdio bridge fragility        | Phase 2: for system-level control (file access, OS shortcuts)          |
| WebGPU Whisper                      | ~400MB download, WASM threads, GPU variance, cold start 5-15s | Phase 2: swap Web Speech → Whisper behind same `STTProvider` interface |
| Offline Mode                        | Requires local LLM + local STT                                | Phase 2: after cloud path is solid                                     |
| Multi-profile / Auth                | Cookies, logins add flakiness                                 | Hardcode one logged-in session or use public sites                     |
| Complex target apps (Gmail, Notion) | Anti-automation, dynamic DOM                                  | Stick to HN / Wikipedia / demo CRUD app you control                    |

### 🔜 PHASE 2 (After Demo)

1. Define `STTProvider` interface — swap Web Speech → Whisper without touching agent logic
2. Extract HUD into Extension content script (same React component, new mount point)
3. Add Native Host for file-system & OS-level actions
4. Add local LLM fallback (Ollama) behind same `Planner` interface

---

## 4. ARCHITECTURE — SINGLE NODE LOOP

```
                ┌──────────────────────────────────────────────┐
                │              Node.js Process                 │
                │                                              │
  Mic ──►  ┌────┴─────┐    WebSocket     ┌──────────────────┐  │
           │  Chrome  │◄────────────────►│  Express + WS    │  │
           │  Tab     │  Web Speech API   │  Server          │  │
           │ (HUD UI) │   transcript      │  ├── /hud (static)│  │
           └────┬─────┘                  │  ├── ws:voice     │  │
                │ Playwright CDP         │  └── ws:agent     │  │
                │                        └────────┬─────────┘  │
                │                                 │            │
                │                        ┌────────▼─────────┐  │
                │                        │   Agent Loop     │  │
                │                        │  ┌────────────┐  │  │
                └───────────────────────►│  │ p-queue(1) │  │  │
                  act/observe/highlight  │  │+AbortCtrl  │  │  │
                                         │  └─────┬──────┘  │  │
                                         │        │         │  │
                              ┌──────────┴────────▼────┐    │  │
                              │  Planner (DeepSeek)    │    │  │
                              │  Zod: ActionPlanSchema │    │  │
                              └──────────┬─────────────┘    │  │
                                         │                  │  │
                              ┌──────────▼──────────┐       │  │
                              │ Verifier (DeepSeek) │       │  │
                              │ "did it succeed?"   │       │  │
                              └─────────────────────┘       │  │
                └──────────────────────────────────────────────┘

Loop:  voice:final → push to p-queue → observe → plan (DeepSeek+Zod) → highlight → act → verify → HUD update
       ▲ new voice ── abort current ────────────────────────────────────────────────────────────────┘
```

**Key file layout (all in one repo, one `npm run dev`):**

```
/handsfree-prototype
├── src/
│   ├── server.ts              # Express + WS, spawns Playwright
│   ├── agent/
│   │   ├── loop.ts            # p-queue + AbortController orchestration
│   │   ├── planner.ts         # DeepSeek + Zod observe→plan
│   │   ├── verifier.ts        # screenshot/DOM → "success?" check
│   │   └── stt.ts             # STTProvider interface (Web Speech now, Whisper later)
│   ├── browser/
│   │   ├── launch.ts          # Playwright launch (headed, visible)
│   │   ├── highlight.ts       # injectHighlight(selector) CSS
│   │   └── hud.ts             # inject HUD HTML/CSS/JS into page
│   └── hud/
│       ├── index.html         # HUD overlay (floating bottom-right)
│       ├── hud.ts             # renders transcript, plan, status (WebSocket client)
│       └── speech.ts          # webkitSpeechRecognition wiring
├── .env                       # DEEPSEEK_API_KEY
└── package.json               # one dev script
```

---

## 5. FEATURE SPEC — MVP DETAIL

### F1: Voice Input (Web Speech API)

- **Implementation:** `webkitSpeechRecognition` with `continuous: true, interimResults: true, lang: 'en-US'`
- **UI:** HUD shows interim transcript in gray, final in white. Mic icon green = listening, red = muted
- **Fallback:** Hold `Space` = push-to-talk (avoids background noise). Button "Click to enable mic" for autoplay policy
- **Output:** `{ text: string, isFinal: boolean, confidence: number }` over `ws:voice`
- **Edge:** Add `speechSynthesis` echo: agent says "Going to Hacker News" (optional, big demo wow for free)

### F2: HUD Overlay (No Extension)

- **How:** Playwright `page.addInitScript()` + `page.evaluate()` injects a `<div id="hf-hud">` fixed bottom-right (320px × 400px)
- **Shows:**
  - Mic status + live transcript
  - Current plan: `→ Observing... → Found X targets → Acting: click "XYZ"`
  - Verification result: `✓ Verified` or `↻ Retrying (1/2)`
  - Big red `STOP` / `Interrupt` button (also voice-triggered)
- **Tech:** Vanilla JS or tiny Preact (no build pain). Tailwind CDN or inline CSS. WebSocket to Node process.

### F3: Observe → Plan (DeepSeek + Zod)

```typescript
// planner.ts — contract between Dev1 and Dev2
const ActionPlanSchema = z.object({
  action: z.enum(['click', 'type', 'navigate', 'scroll', 'wait']),
  target: z.string().describe('natural language description of target'),
  selector: z.string().optional(), // filled by Stagehand observe
  value: z.string().optional(), // for type/navigate
  reasoning: z.string(),
  confidence: z.number().min(0).max(1),
});

// prompt skeleton (Dev1 owns tuning)
system: `You are HandsFree planner. Given user intent + page observation candidates, pick ONE next action.
         Return ONLY valid JSON matching ActionPlanSchema. Prefer high-confidence targets.
         If no candidate matches (confidence < 0.6), return action "wait" and explain why.`;

user: `Intent: "${transcript}"
       Candidates: ${JSON.stringify(candidates, null, 2)}
       Current URL: ${page.url()}`;
```

- **Model:** DeepSeek Chat (fast, cheap). Temperature 0.1 for determinism
- **Validation:** Zod parse → if fail, retry once with "fix JSON" prompt

### F4: Act + Highlight

- `observe()` → get candidates → `injectHighlight(candidates[0].selector)` → 600ms pause (so audience _sees_ it) → `act()`
- Highlight CSS:

```css
.hf-highlight {
  outline: 3px solid #facc15 !important;
  outline-offset: 2px !important;
  background: rgba(250, 204, 21, 0.15) !important;
  transition: all 0.25s ease !important;
  animation: hf-pulse 1s ease-in-out infinite;
}
```

- **Why 600ms pause:** Demo is theater. The pause _is_ the feature — judges need to see the agent "think" before it acts.

### F5: Interrupt (p-queue + AbortController)

```typescript
const queue = new PQueue({ concurrency: 1 });
let currentAbort = new AbortController();

ws.on('voice:final', (text) => {
  if (text.match(/stop|cancel|wait|hold on/i)) {
    currentAbort.abort(); // cancels current observe/plan/act
    queue.clear(); // drops pending tasks
    hud.send({ type: 'interrupted' });
    return;
  }
  currentAbort = new AbortController();
  queue.add(() => runAgentLoop(text, currentAbort.signal));
});

// inside runAgentLoop, every async step checks signal.aborted
```

- **Test:** Start long task (e.g., "scroll through 5 articles"), interrupt at article 2 → must stop within <500ms

### F6: Verify & Retry Loop

```typescript
async function verify(task: string, signal: AbortSignal) {
  const snapshot = await page.content(); // or screenshot base64
  const result = await deepseek.judge({ task, snapshot }); // Zod: { success: boolean, reason: string }
  if (!result.success && retries < 2) {
    hud.send({ type: 'retry', reason: result.reason });
    return runAgentLoop(`retry: ${task} — previous attempt failed: ${result.reason}`, signal);
  }
  hud.send({ type: result.success ? 'verified' : 'failed', reason: result.reason });
}
```

- Max 2 retries. If still failing, HUD shows "Need help — click to take over" (graceful failure > infinite loop)

---

## 6. TECH STACK — ONE-STACK, ZERO BRIDGES

| Layer               | Choice                       | Why (ruthless)                                         |
| ------------------- | ---------------------------- | ------------------------------------------------------ |
| **Runtime**         | Node.js 20+ + TypeScript     | One language, one process                              |
| **Browser Control** | Playwright + Stagehand       | `observe()`/`act()` is your moat — no manual selectors |
| **Server**          | Express + `ws`               | Serves HUD, handles WS, 20 lines of code               |
| **STT**             | Web Speech API               | Zero install, <100ms, no GPU                           |
| **LLM**             | DeepSeek Chat API            | Fast, cheap, good at structured output                 |
| **Validation**      | Zod                          | Guarantees `ActionPlan` shape, auto-retry on bad JSON  |
| **Queue**           | `p-queue`                    | Concurrency 1 + abort = bulletproof interrupt          |
| **Styling**         | Tailwind CDN (or inline CSS) | No build step for HUD                                  |
| **Env**             | `dotenv`, `tsx`              | `npm run dev` is the entire DX                         |

**`package.json` essentials:**

```json
{
  "scripts": { "dev": "tsx watch src/server.ts", "demo": "tsx src/server.ts --demo" },
  "dependencies": {
    "express": "^4.19",
    "ws": "^8.17",
    "playwright": "^1.44",
    "@browserbasehq/stagehand": "latest",
    "p-queue": "^8.0",
    "zod": "^3.23",
    "openai": "^4.50",
    "dotenv": "^16.4"
  }
}
```

---

## 7. TEAM SPLIT — 3 DEVS, 3 LANES, 0 BLOCKERS

### Dev 1: Audio / AI — "The Brain"

**Owns:** Everything that turns voice into a structured plan

| Task                                     | Output                                                     | Done When                                                     |
| ---------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| Web Speech wrapper (`src/hud/speech.ts`) | `speech.ts` + mic UI states                                | Interim + final transcript visible in HUD, push-to-talk works |
| DeepSeek client + Zod schemas            | `planner.ts`, `verifier.ts`                                | `ActionPlanSchema.parse()` passes on 10/10 rehearsed prompts  |
| Prompt tuning for observe→plan           | System prompt + few-shot examples for HN/Wikipedia         | 90%+ correct action on rehearsed site                         |
| STTProvider interface                    | `stt.ts` with `interface STTProvider { onTranscript(cb) }` | Web Speech implements it; Whisper can be swapped later        |

**Day 1 deliverable:** `planner.ts` returns valid `ActionPlan` for 3 test intents without browser
**Day 2 deliverable:** Voice → plan latency <1.5s end-to-end

### Dev 2: Automation — "The Hands"

**Owns:** Everything that makes the browser _do_ things reliably

| Task                                  | Output                               | Done When                                           |
| ------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| Stagehand `observe()`/`act()` harness | `browser/launch.ts`, `agent/loop.ts` | Can click/type on HN without flakiness              |
| `p-queue` + `AbortController` loop    | `loop.ts`                            | New voice input aborts current queue in <500ms      |
| Highlight injection                   | `highlight.ts`                       | Yellow pulse visible for 600ms before every act     |
| Verification loop                     | `verifier.ts` (with Dev1)            | After act, auto-detects success/failure and retries |

**Day 1 deliverable:** Hardcoded `runAgentLoop("open top HN story")` works without voice
**Day 2 deliverable:** Interrupt + verify + retry work under voice control

### Dev 3: Systems — "The Stage"

**Owns:** Everything the judge _sees_ and the demo logistics

| Task                       | Output                                | Done When                                                      |
| -------------------------- | ------------------------------------- | -------------------------------------------------------------- |
| Express + WS server        | `server.ts`                           | `npm run dev` launches Playwright headed + serves HUD          |
| HUD overlay UI             | `hud/index.html`, `hud/hud.ts`        | Floating panel shows transcript, plan, status, stop button     |
| Highlight + HUD injection  | `hud.ts` (injection logic)            | HUD persists across navigations, doesn't break target site CSS |
| Rehearsal + demo logistics | Demo script, fallback plan, recording | Full dry-run recorded, 3 failure scenarios rehearsed           |

**Day 1 deliverable:** Visible Chrome window + HUD overlay rendering live
**Day 2 deliverable:** Owns rehearsal; has backup video + "manual take over" button

**Contracts (so lanes don't block):**

- Dev1 ↔ Dev2: `ActionPlanSchema` (Zod) is the law. Dev2 can mock planner with hardcoded JSON until Dev1 ships.
- Dev2 ↔ Dev3: `ws` message shapes (`voice:final`, `agent:plan`, `agent:verifying`, `agent:done`) agreed Day 1 morning.
- All: One repo, one `main` branch, push every 2 hours, `npm run dev` must always work.

---

## 8. 2-DAY TIMELINE — HOUR BY HOUR

### DAY 1 — Make It Work (No Polish)

| Time            | All Hands                                                                                                                                              | Dev 1 (Brain)                                             | Dev 2 (Hands)                                                         | Dev 3 (Stage)                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------ |
| **09:00-10:00** | **Kickoff:** Agree `ActionPlanSchema`, `ws` message shapes, target site (HN). Create repo, `npm init`, one `server.ts` that launches Playwright headed | —                                                         | —                                                                     | —                                                            |
| **10:00-12:30** | —                                                                                                                                                      | Web Speech `speech.ts` + interim transcript UI            | Stagehand harness: `observe` → `act` on HN (hardcoded intent, no LLM) | Express + WS + HUD injection skeleton (floating div appears) |
| **12:30-13:00** | **Lunch + Merge #1:** `npm run dev` must show HUD + do one hardcoded click                                                                             | —                                                         | —                                                                     | —                                                            |
| **13:00-15:30** | —                                                                                                                                                      | DeepSeek + Zod `planner.ts` (test with mocked candidates) | `p-queue` + `AbortController` loop + highlight injection              | HUD polish: transcript, plan, status rendering via WS        |
| **15:30-16:00** | **Merge #2:** Voice → plan → act works (even if flaky)                                                                                                 | —                                                         | —                                                                     | —                                                            |
| **16:00-18:00** | —                                                                                                                                                      | Prompt tuning + verifier `judge()`                        | Verification loop + retry logic                                       | WS wiring end-to-end: voice → server → agent → HUD           |
| **18:00-18:30** | **E2E Test:** Full voice → HN → click flow. Log every failure. Decide what to harden tomorrow                                                          | —                                                         | —                                                                     | —                                                            |

**Day 1 Exit Criteria:** One complete voice → browser action works (even if 60% reliable). HUD shows live transcript + plan.

### DAY 2 — Make It Demoable (Reliability + Theater)

| Time            | All Hands                                                                                                       | Dev 1                                                      | Dev 2                                                  | Dev 3                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **09:00-10:30** | —                                                                                                               | Tune prompts for interrupt intents ("stop", "actually...") | Harden interrupt: voice-abort in <500ms, queue.clear   | Add HUD theater: 600ms highlight pause, status animations, TTS echo                                         |
| **10:30-12:00** | —                                                                                                               | Latency pass: stream interim, debounce final (300ms)       | Retry robustness: max 2, graceful "need help" fallback | Rehearsal target app lockdown: pick 1 site, hardcode 3 demo paths                                           |
| **12:00-13:00** | **Full Dry Run #1:** Record video. Time each moment (M1-M5). Fix top 2 flakes                                   | —                                                          | —                                                      | —                                                                                                           |
| **13:00-14:00** | Lunch + **Dry Run #2** with interrupt scenario                                                                  | —                                                          | —                                                      | —                                                                                                           |
| **14:00-15:30** | —                                                                                                               | —                                                          | —                                                      | **Dev3 owns:** Backup video export, "manual override" button, mic permission checklist, second laptop ready |
| **15:30-16:30** | **Dress Rehearsal:** Full demo script, 3× in a row, no code changes between runs. If it passes 2/3, freeze code | —                                                          | —                                                      | —                                                                                                           |
| **16:30+**      | **SHIP:** No more features. Only `git tag prototype-freeze` + README with one-liner `npm run dev`               | —                                                          | —                                                      | —                                                                                                           |

**Rule:** After 15:30 Day 2, no new code unless demo is broken. Only rehearsal.

---

## 9. DEMO SCRIPT (90 SECONDS — REHEARSE THIS EXACTLY)

> **Setup (before judges arrive):** `npm run demo` already running. Chrome visible on projector. HUD in bottom-right. Mic permission granted. Backup video queued.

| Time | You Say                                                                                                           | Agent Does                                                                                                             | Judge Sees                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 0:00 | _"HandsFree is voice control for any website — no extension, fully interruptible."_                               | HUD shows `Listening...`                                                                                               | Mic green, HUD alive                                      |
| 0:10 | **"Go to Hacker News and open the top story"**                                                                    | HUD: `Heard: "Go to Hacker News..."` → `Observing...` → `Plan: click "Show HN: ..."` → yellow highlight pulses → click | Live navigation — the highlight _is_ the demo             |
| 0:30 | _(page loads)_                                                                                                    | HUD: `Verifying... ✓ Landed on article`                                                                                | Verification badge appears                                |
| 0:35 | **"Stop — actually, search for AI news instead"**                                                                 | HUD: `⚡ Interrupted` → `New plan: type "AI" in search` → highlight → type → enter                                     | Interrupt is the wow moment — show you can talk _over_ it |
| 0:55 | _"Every action is observed, planned with DeepSeek, highlighted, then verified — and you can interrupt any time."_ | HUD shows full reasoning trace                                                                                         | Judge sees the loop, not just the result                  |
| 1:10 | _"This is the loop. The extension and local Whisper are Phase 2 — today we prove the interaction is real."_       | —                                                                                                                      | Honest scope framing = credibility                        |

**If it fails live:** _"Let me show you the recording from 10 minutes ago — same code, same loop"_ → play backup video (Dev3's job).

---

## 10. RISKS & MITIGATIONS — WHAT WILL ACTUALLY BREAK

| Risk                                | Likelihood | Mitigation (Do This Now)                                                                                                                      |
| ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mic permission / autoplay block** | High       | Dev3: Big "Enable Mic" button on HUD that calls `getUserMedia` on user gesture. Test in fresh Chrome profile                                  |
| **Web Speech API lag / no interim** | Medium     | Dev1: Push-to-talk (Space) fallback. Debounce final 300ms, show interim gray immediately                                                      |
| **Stagehand picks wrong target**    | High       | Dev1: Tune prompt + lower confidence threshold → if <0.6, HUD says "Not sure — retrying with new observation" instead of clicking wrong thing |
| **Target site changes DOM**         | Medium     | Day 2: Lock to ONE site, hardcode fallback selectors, have backup demo CRUD app (`localhost:3000/demo`) you control                           |
| **DeepSeek latency spike**          | Low        | Show `Thinking...` spinner + stream HUD updates. Timeout 8s → retry once                                                                      |
| **Interrupt doesn't abort**         | High       | Dev2: Every `await` checks `signal.aborted`. Test interrupt 20× Day 2. No `await` without signal check                                        |
| **HUD breaks target CSS**           | Low        | Use Shadow DOM or `!important` + high `z-index: 2147483647`. Test on target site Day 1                                                        |

---

## 11. WHAT YOU TELL JUDGES (HONEST SCOPE FRAMING)

> _"We cut the extension, native app, and local Whisper for the 2-day prototype — on purpose. Those are the highest-risk integrations, and with 48 hours, reliability beats completeness. We run one Node process + Web Speech + Stagehand so you see a real browser, real voice, real highlights, and real interrupt. The STT and planner are behind interfaces — we swap in Whisper and the extension shell in Phase 2 without changing the agent loop. Today we prove the loop is real and cool; next we make it shippable."_

This lands as **mature engineering**, not missing scope.

---

## 12. PHASE 2 — AFTER THE DEMO

```
Prototype (Day 2)              Phase 2 (Next 2 Weeks)
─────────────                  ───────────────────────
Web Speech API          ──►    Whisper WebGPU (behind STTProvider)
Single Node + Playwright ──►   Chrome Extension (HUD moves to content script)
Express HUD injection   ──►    Extension popup + options page
One rehearsed site      ──►    Generic site handling + auth
DeepSeek only           ──►    DeepSeek + local Ollama fallback
No persistence          ──►    Session replay + skill memory
```

**Interface to protect:**

```typescript
interface STTProvider {
  start(): void;
  onTranscript(cb: (t: Transcript) => void): void;
  stop(): void;
}
interface Planner {
  plan(intent: string, candidates: Candidate[]): Promise<ActionPlan>;
}
```

Keep these stable and Phase 2 is a swap, not a rewrite.

---

## 13. CHECKLISTS

### Pre-Demo (Dev3 owns, 30 min before)

- [ ] Fresh Chrome profile, mic permission granted, `npm run demo` running
- [ ] Target site loaded, logged in (if needed), HUD visible
- [ ] Backup video recorded and queued (screen + mic audio)
- [ ] Second laptop / phone hotspot ready (network fallback)
- [ ] `Space` push-to-talk tested, `Stop` button tested, interrupt tested 3×
- [ ] No `console.log` spam, no `.env` on screen

### Freeze Criteria (15:30 Day 2)

- [ ] Voice → act works 2/3 rehearsals
- [ ] Interrupt works 3/3
- [ ] Highlight visible on projector (test from back of room)
- [ ] `git tag prototype-freeze` + `README.md` with `npm install && npm run dev`

---

**Build the loop. Prove the theater. Ship the interfaces. The extension can wait.**

_One Node app. One visible browser. Real voice, real highlights, real interrupt. That's the whole prototype._
