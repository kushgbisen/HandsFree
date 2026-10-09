# Viva Defense Sheet — HandsFree (Major Project)

One-line project: voice-controlled Chrome extension — speak/type a command on
any site, an AI agent observes the live page, acts, verifies, and is
interruptible. No server.

## 1. Programming concepts (with file pointers)

- **Declaration vs definition:** `observe(): Promise<Candidate[]>` is _declared_
  as a contract and _defined_ with the ARIA scan body (`content.ts`); same for
  `runGoal` (`loop.ts`) and `callLLM` (`llm.ts`).
- **Looping:** bounded `for` step loop, max 5 (`loop.ts` runGoal); `while`
  serial command queue (`background.ts`); `for(;;)` SSE stream reader
  (`llm.ts`); retry counters cap invalid model outputs at 2 per step.
- **Guard conditions:** `signal.aborted` checked before every await (interrupt);
  action index bounds-checked in `validateStep` (`prompts.ts`); empty-candidate
  and unknown-tool rejections; `t.timeout` on model calls (25 s stream, 15 s
  plain); `MAX_STEPS` bounds the loop.
- **Language understanding:** TypeScript strict types + narrowing
  (`instanceof`, `typeof` guards); `async/await` over message-passing;
  MV3 split worlds (classic content script vs module worker — one `export`
  token kills injection, hence dependency-free `content.ts`).

## 2. IPC

| Path          | Mechanism                                                                                |
| ------------- | ---------------------------------------------------------------------------------------- |
| Pill → worker | `chrome.runtime.sendMessage` (`speech`, `hello`)                                         |
| Worker → page | `chrome.tabs.sendMessage` (`observe`, `act`, `pressEnter`, `scroll`, `highlight`, `hud`) |
| Results back  | same channels reversed (`{candidates}`, `{ok}`)                                          |
| Liveness      | `runtime.connect` keepalive Port; `chrome.storage.local` for keys                        |

## 3. Modularity / coupling / cohesion

One job per file (`content` senses/acts, `background` queues/routes, `loop`
decides, `tools` executes, `prompts` contracts, `llm` connects, `popup`
configures) = high cohesion. Layers share only two JSON contracts
(`Candidate`, step) = low coupling: swap the model without touching page code.

## 4. External libraries & APIs

MV3 `chrome.tabs/runtime/storage/scripting`; Gemini `streamGenerateContent`
SSE + OpenAI-compatible `chat/completions` streaming via direct `fetch` (no
SDK); frozen Node harness: Playwright, Express, Zod, p-queue. Reasoning is
API-based; nothing ML runs locally.

## 5. Likely panel questions (one-line answers)

1. _Why extension, not an app?_ — acts in the user's own tabs/session; no server.
2. _How does it "see"?_ — ARIA roles + accessible names, ranked, top 15.
3. _What stops wrong clicks?_ — model picks only listed indices; validator rejects the rest; verifier loop + interrupt.
4. _Interrupt mechanism?_ — per-command AbortController; stop aborts the running one, clears the queue (< 500 ms).
5. _No API key?_ — single-rule keyword fallback; pill nudges to set a key.
6. _Why ReAct?_ — one validated decision per step replaces plan+verify chains; fewer calls, invalid output unexecutable.
7. _Slow?_ — one streamed call per step; local ranking/heuristic paths cost ~0 ms.
8. _Privacy?_ — key in local storage, page text per command only, no analytics.
9. _Limits?_ — desktop Chrome only; cross-origin iframes invisible; destructive actions need a confirm gate (future work).
10. _60% proof?_ — loop, voice, interrupt, verify, setup all committed; see SRS §10 traceability.

## 6. Demo runbook

Tabs ready: Google + a video. Commands in order: `search for cats` →
`open myupes website` → `stop` mid-task → replacement command. Type if mic
wobbles. If anything fails: read the think line aloud (narrated failure is the
design), then open SRS diagrams.
