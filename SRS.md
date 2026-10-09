# Software Requirement Specification — HandsFree

**Version:** 0.1 (midterm) · **Track:** Major Project · **Author:** project team

## 1. Introduction

### 1.1 Purpose

HandsFree lets a user operate any website by voice (with typing as fallback):
speak or type a command in the on-page assistant, and an AI agent observes the
live page, plans one action, shows its thinking, highlights the target, acts,
verifies the outcome, and can be interrupted mid-task.

### 1.2 Scope

In scope: MV3 Chrome extension working on the user's own tabs (any site),
voice + typed commands, single and bounded multi-step tasks (max 5 steps),
interrupt, key setup popup. Out of scope: mobile browsers, file downloads,
payments/banking automation, multi-tab orchestration, offline mode.

### 1.3 Definitions

STT (speech-to-text), ARIA (accessible roles/names), LLM (large language
model), SW (service worker), pill (on-page assistant card).

## 2. Overall Description

### 2.1 Product perspective

Single extension, three parts: content script (eyes/hands/pill, runs in every
page), background service worker (brain/queue), popup (key setup). No server,
no second browser window. A frozen Node prototype (`src/`) exists only as a
deterministic demo harness.

### 2.2 User classes

End users (browse hands-free); evaluators (verify M1–M5 acceptance).

### 2.3 Constraints & assumptions

Desktop Chrome 109+; internet for LLM; user grants mic per site; pages expose
standard ARIA semantics; cross-origin iframes are not visible to the agent.

## 3. Functional Requirements

| ID   | Requirement                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR1  | Voice input via built-in Web Speech API in the page; interim text live, final result dispatched as a command; typed fallback in the pill          |
| FR2  | Observe: scan the live DOM into role + accessible-name candidates (cap 200), excluding the pill itself, hidden and disabled nodes                 |
| FR3  | Rank candidates against intent (keyword + fill-intent box boost); scroll-to-discover (max 3) when nothing relevant is in view                     |
| FR4  | Plan: LLM picks ONLY a listed candidate index plus optional typed value; top-15 pre-ranked shortlist; keyword fallback without a key              |
| FR5  | Act: highlight target (400 ms), then click / fill (human-like: expand, focus, real keystroke events, Enter for searches)                          |
| FR6  | Chained submit: fill + post in one command (Enter-first for search, button hunt for comments)                                                     |
| FR7  | Verify: LLM judge over before/after snapshots decides success AND whether the original goal needs another step (max 5); heuristics on LLM failure |
| FR8  | Interrupt: "stop/cancel/wait" aborts the running controller, clears the queue, accepts a replacement intent ("stop, actually …")                  |
| FR9  | HUD: single-line status + streaming thought line, mic morphs to stop while working, minimize, light/dark adaptive                                 |
| FR10 | Key setup: provider + model + key with live Test against the provider; first-run nudge when no key is saved                                       |

## 4. Non-Functional Requirements

- Performance: single-step command typically 3–6 s (1–3 LLM calls); heuristic paths add ~0 ms.
- Reliability: every failure surfaces on the pill with a retry hint; no silent hangs; abort < 500 ms.
- Usability: one input bar, one result line; empty states and mic errors in plain words.
- Privacy: key in `chrome.storage.local`, sent only to the chosen provider; page text sent per command; no analytics.
- Portability: any desktop Chrome; any public website with standard semantics.

## 5. Architecture & Methodology

Single-process MV3 design: page (senses/acts) ↔ worker (thinks/queues) ↔
provider (reasons). Contracts between layers are Zod-shaped JSON
(`Candidate {id,selector,description,method,role}`, `Plan {index,reasoning,value?}`),
so any layer can be swapped (e.g. local model for cloud) without touching the others.

Methodology: **iterative prototyping**. A 48-hour ruthless prototype proved the
loop on one page first (voice → observe → plan → highlight → act → verify →
interrupt); each iteration since replaced one simulated part with a real one
(ARIA eyes, real verifier, step loop). Chosen over waterfall because the core
risk was interaction feasibility, not specification completeness.

```mermaid
flowchart LR
    User([User voice / type]) <--> Pill[Pill UI + STT\ncontent.ts]
    Pill <-->|observe / act / highlight| Page[Live page DOM]
    Pill <-->|speech / hud / scroll| SW[Background worker\nqueue + planner + verifier]
    SW <-->|stream + JSON| LLM[(LLM provider\nGemini / OpenRouter / DeepSeek / OpenAI)]
    Popup[Toolbar popup\nkey setup] -->|chrome.storage| SW
```

## 6. IPC Design

| Channel       | Mechanism              | Payload                                                 |
| ------------- | ---------------------- | ------------------------------------------------------- |
| Pill → worker | `runtime.sendMessage`  | `{type:'speech', text, isFinal}`, `{type:'hello'}`      |
| Worker → page | `tabs.sendMessage`     | `observe / act / pressEnter / scroll / highlight / hud` |
| Page → worker | `runtime.sendMessage`  | `{candidates}`, `{ok}`                                  |
| Keepalive     | `runtime.connect` Port | worker stays alive mid-task                             |
| Key storage   | `chrome.storage.local` | provider, model, apiKey                                 |

## 7. Modularity, Coupling, Cohesion

High cohesion (one job per file: `content.ts` senses/acts, `background.ts`
orchestrates, `llm.ts` talks providers, `popup.ts` configures). Low coupling:
layers share only the `Candidate`/`Plan` contracts — the planner never sees the
DOM, the page never sees the model. Content scripts are dependency-free classic
scripts (one module token kills injection); the worker alone uses modules.

## 8. External Libraries & APIs

Playwright + Express + Zod + p-queue (frozen Node demo harness only); Google
AI (`streamGenerateContent` SSE) and OpenAI-compatible `chat/completions`
streaming (product path, direct `fetch`, no SDK); MV3 `chrome.tabs/runtime/
storage/scripting` APIs. No ML runs locally — reasoning is API-based.

## 9. Use Cases & Acceptance

- UC1 voice search: "search for cats" on Google → results page, verified.
- UC2 voice comment: "comment nice video" on a video → comment posted, verified.
- UC3 interrupt: "stop" mid-task → halts < 500 ms, accepts next command.

Acceptance (maps to demo moments M1–M5): M1 transcript < 300 ms; M2 valid
plan 10/10 rehearsed; M3 highlight visible before every act; M4 interrupt
aborts and re-plans; M5 failure detected and retried (max 2), then help text.

```mermaid
sequenceDiagram
    participant U as User
    participant P as Pill (page)
    participant W as Worker
    participant L as LLM
    U->>P: speak / type
    P->>W: speech {text}
    W->>P: observe → candidates
    W->>W: rank + scroll-to-discover
    W->>L: plan (streaming)
    L-->>P: thought deltas
    W->>P: highlight → act
    W->>P: observe (after)
    W->>L: verify + goalDone?
    L-->>W: {success, goalDone, next}
    W->>P: Verified / next step (max 5)
```

```mermaid
flowchart LR
    U([User]) -- 1. command --> P[Pill]
    P -- 2. speech --> W[Worker]
    W -- 3. observe --> P
    P -- 4. candidates --> W
    W -- 5. plan --> L[LLM]
    L -- 6. index+value --> W
    W -- 7. highlight+act --> P
    W -- 8. verify --> L
    L -- 9. verdict --> W
    W -- 10. status --> P
    P -- 11. shows --> U
```
