import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initBrowser, getPage, getBrowser } from './browser/launch.js';
import { observe } from './browser/observe.js';
import { plan } from './agent/planner.js';
import { execute } from './agent/loop.js';

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
    // 1. fresh observation — no persisted knowledge, every page is unknown
    const page = getPage();
    const browser = getBrowser();
    console.log(
      `[command] "${text}" — page closed=${page.isClosed()} browser connected=${browser.isConnected()} url=${page.url()}`,
    );

    const candidates = await observe();
    console.log(`[command] observed ${candidates.length} candidates`);

    if (candidates.length === 0) {
      return res.status(500).json({ message: 'no candidates observed' });
    }

    // 2. plan — may only choose from what was just observed
    const chosen = await plan(text, candidates);
    const candidate = candidates[chosen.index];
    console.log(
      `[command] plan chose id=${chosen.index} -> ${candidate.description} reasoning="${chosen.reasoning}"`,
    );

    // 3. execute — direct on exact observed element
    await execute(chosen, candidates);

    res.json({
      message: `executed id ${chosen.index} -> ${candidate.description}`,
      plan: chosen,
      candidate,
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
