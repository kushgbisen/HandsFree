import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initBrowser, getPage, getBrowser } from './browser/launch.js';
import { observe, type Candidate } from './browser/observe.js';
import { plan, type Plan } from './agent/planner.js';
import { execute } from './agent/loop.js';
import { verify } from './agent/verifier.js';

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

app.post('/command', async (req, res) => {
  const text: string | undefined = req.body?.text?.trim();
  if (!text) return res.status(400).json({ message: 'missing text' });

  try {
    const page = getPage();
    const browser = getBrowser();
    console.log(
      `[command] "${text}" — page closed=${page.isClosed()} browser connected=${browser.isConnected()} url=${page.url()}`,
    );

    let beforeUrl = page.url();
    let lastPlan: Plan | null = null;
    let lastCandidate: Candidate | null = null;
    let candidates: Candidate[] = [];
    let retries = 0;
    const maxRetries = 2;

    // verify loop — fresh observe every iteration
    while (retries <= maxRetries) {
      candidates = await observe();
      console.log(
        `[command] observed ${candidates.length} candidates (try ${retries + 1}/${maxRetries + 1})`,
      );
      if (candidates.length === 0) throw new Error('no candidates observed');

      const chosen = await plan(text, candidates);
      const candidate = candidates[chosen.index];
      console.log(
        `[command] plan chose id=${chosen.index} -> ${candidate.description} reasoning="${chosen.reasoning}"`,
      );

      await execute(chosen, candidates);

      // small settle before verify
      await new Promise((r) => setTimeout(r, 400));
      const afterUrl = page.url();
      const afterCandidates = await observe();
      const result = await verify(text, chosen, beforeUrl, afterUrl, afterCandidates);
      console.log(
        `[verify] ${result.success ? '✓' : '↻'} ${result.reason} (retry ${retries}/${maxRetries})`,
      );

      lastPlan = chosen;
      lastCandidate = candidate;

      if (result.success) {
        return res.json({
          message: `✓ verified id ${chosen.index} -> ${candidate.description} — ${result.reason}`,
          plan: chosen,
          candidate,
          candidates: afterCandidates,
          verification: result,
        });
      }

      if (retries === maxRetries) {
        return res.json({
          message: `need help — click to take over (after ${retries + 1} tries): ${result.reason}`,
          plan: chosen,
          candidate,
          candidates: afterCandidates,
          verification: result,
        });
      }

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
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[command] failed:', msg);
    res.status(500).json({ message: `failed: ${msg}` });
  }
});

try {
  console.log(`[server] launching browser → ${testUrl}`);
  await initBrowser(testUrl);
  console.log('[server] browser ready');
} catch (err) {
  console.warn('[server] browser init failed (will retry on first /command):', err);
}

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  console.log(`[server] HUD at http://localhost:${port}/  — say "click sign in"`);
});
