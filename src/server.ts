import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initBrowser, getPage, getBrowser } from './browser/launch.js';
import { observe, type Candidate } from './browser/observe.js';
import { plan, type Plan } from './agent/planner.js';
import { execute, queue } from './agent/loop.js';
import { verify } from './agent/verifier.js';
import { injectHud, updateHud } from './browser/hud.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;
const testUrl = process.env.TEST_URL ?? 'https://the-internet.herokuapp.com/login';

app.use(express.json());

const hudDir = path.join(__dirname, 'hud');
app.use(express.static(hudDir));
app.get('/', (_req, res) => res.sendFile(path.join(hudDir, 'index.html')));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

let currentAbort = new AbortController();

function isInterrupt(text: string): boolean {
  return /\b(stop|cancel|wait|hold on|abort)\b/i.test(text);
}

function extractNewIntent(text: string): string | null {
  // "stop — actually search for AI news" -> "search for AI news"
  const actuallyMatch = text.match(/actually[,:]?\s*(.+)/i);
  if (actuallyMatch) return actuallyMatch[1].trim();
  // "stop cancel" with extra words: strip stop words and return remainder
  const cleaned = text
    .replace(/\b(stop|cancel|wait|hold on|abort)\b/gi, '')
    .replace(/[—\-:,]+/g, ' ')
    .trim();
  return cleaned.length > 2 ? cleaned : null;
}

app.post('/command', async (req, res) => {
  let text: string | undefined = req.body?.text?.trim();
  if (!text) return res.status(400).json({ message: 'missing text' });

  // auto-recover if browser died (e.g., first launch failed)
  try {
    const p = getPage();
    if (p.isClosed()) throw new Error('page closed');
  } catch {
    try {
      console.log('[server] re-launching browser...');
      await initBrowser(testUrl);
      await injectHud().catch(() => {});
    } catch (e) {
      console.warn('[server] re-launch failed', e);
    }
  }

  // live interrupt — any new voice can preempt current queue
  if (isInterrupt(text)) {
    const newIntent = extractNewIntent(text);
    currentAbort.abort();
    queue.clear();
    await updateHud({
      status: 'Interrupted',
      verification: '⚡ Interrupted',
      showStop: false,
    }).catch(() => {});
    console.log(`[interrupt] "${text}" -> abort, newIntent=${newIntent ?? 'none'}`);
    if (!newIntent) {
      return res.json({ message: 'interrupted', interrupted: true });
    }
    text = newIntent;
    // fall through to execute newIntent with fresh abort controller
  }
  currentAbort = new AbortController();
  const signal = currentAbort.signal;

  try {
    const page = getPage();
    const browser = getBrowser();
    console.log(
      `[command] "${text}" — page closed=${page.isClosed()} browser connected=${browser.isConnected()} url=${page.url()}`,
    );
    await updateHud({
      transcript: `"${text}"`,
      status: 'Observing...',
      plan: '',
      verification: '',
      showStop: true,
    }).catch(() => {});

    let beforeUrl = page.url();
    let lastPlan: Plan | null = null;
    let lastCandidate: Candidate | null = null;
    let candidates: Candidate[] = [];
    let retries = 0;
    const maxRetries = 2;

    // verify loop — fresh observe every iteration
    while (retries <= maxRetries) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      candidates = await observe();
      console.log(
        `[command] observed ${candidates.length} candidates (try ${retries + 1}/${maxRetries + 1})`,
      );
      await updateHud({
        plan: `Found ${candidates.length} candidates`,
        status: 'Planning...',
      }).catch(() => {});
      if (candidates.length === 0) throw new Error('no candidates observed');

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const chosen = await plan(text, candidates);
      const candidate = candidates[chosen.index];
      console.log(
        `[command] plan chose id=${chosen.index} -> ${candidate.description} reasoning="${chosen.reasoning}"`,
      );
      await updateHud({
        plan: `→ ${candidate.description} — ${chosen.reasoning}`,
        status: 'Acting...',
      }).catch(() => {});

      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await execute(chosen, candidates, signal);
      await updateHud({ status: 'Verifying...' }).catch(() => {});

      // small settle before verify
      await new Promise((r) => setTimeout(r, 400));
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const afterUrl = page.url();
      const afterCandidates = await observe();
      const result = await verify(text, chosen, beforeUrl, afterUrl, afterCandidates);
      console.log(
        `[verify] ${result.success ? '✓' : '↻'} ${result.reason} (retry ${retries}/${maxRetries})`,
      );

      lastPlan = chosen;
      lastCandidate = candidate;

      if (result.success) {
        await updateHud({
          verification: `✓ ${result.reason}`,
          status: 'Verified',
          showStop: false,
        }).catch(() => {});
        return res.json({
          message: `✓ verified id ${chosen.index} -> ${candidate.description} — ${result.reason}`,
          plan: chosen,
          candidate,
          candidates: afterCandidates,
          verification: result,
        });
      }

      if (retries === maxRetries) {
        await updateHud({
          verification: `Need help: ${result.reason}`,
          status: 'Need help',
          showStop: false,
        }).catch(() => {});
        return res.json({
          message: `need help — click to take over (after ${retries + 1} tries): ${result.reason}`,
          plan: chosen,
          candidate,
          candidates: afterCandidates,
          verification: result,
        });
      }

      await updateHud({
        verification: `↻ ${result.reason}`,
        status: `Retrying ${retries + 1}/${maxRetries}`,
      }).catch(() => {});
      console.log(`[verify] ↻ retrying (${retries + 1}/${maxRetries}) — ${result.reason}`);
      beforeUrl = afterUrl;
      retries++;
    }

    // fallback (should not reach)
    res.json({
      message: `executed id ${lastPlan?.index} -> ${lastCandidate?.description}`,
      plan: lastPlan,
      candidate: lastCandidate,
      candidates,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.log('[command] aborted');
      return res.json({ message: 'interrupted', interrupted: true });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[command] failed:', msg);
    res.status(500).json({ message: `failed: ${msg}` });
  }
});

try {
  console.log(`[server] launching browser → ${testUrl}`);
  await initBrowser(testUrl);
  await injectHud().catch((e) => console.warn('[hud] inject failed', e));
  console.log('[server] browser ready');
} catch (err) {
  console.warn('[server] browser init failed (will retry on first /command):', err);
}

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  console.log(`[server] HUD at http://localhost:${port}/  — say "click sign in"`);
});
