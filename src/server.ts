import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initBrowser, getPage } from './browser/launch.js';
import { plan } from './agent/planner.js';
import { execute } from './agent/loop.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT) || 3000;
const testUrl = process.env.TEST_URL ?? 'https://the-internet.herokuapp.com/login';

app.use(express.json());

// serve HUD (index.html + static)
const hudDir = path.join(__dirname, 'hud');
app.use(express.static(hudDir));
app.get('/', (_req, res) => res.sendFile(path.join(hudDir, 'index.html')));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/command', async (req, res) => {
  const text: string | undefined = req.body?.text?.trim();
  if (!text) return res.status(400).json({ message: 'missing text' });

  try {
    // 1. DOM snapshot — prefer stagehand.observe, fallback to page.content
    let snapshot = '';
    try {
      const page = getPage();
      // stagehand observe gives structured candidates; page.content gives raw html
      snapshot = await page.content();
      // keep it small for LLM
      snapshot = snapshot.slice(0, 12000);
    } catch {
      snapshot = `page url: ${testUrl}`;
    }

    // 2. plan
    const actions = await plan(text, snapshot);
    if (actions.length === 0) {
      return res.json({ message: 'no actions planned', actions });
    }

    // 3. execute
    await execute(actions);

    res.json({
      message: `executed ${actions.length} action(s): ${actions.map((a) => `${a.type} "${a.target}"`).join(', ')}`,
      actions,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[command] failed:', msg);
    res.status(500).json({ message: `failed: ${msg}` });
  }
});

// init browser first, then listen
try {
  console.log(`[server] launching browser → ${testUrl}`);
  await initBrowser(testUrl);
  console.log('[server] browser ready');
} catch (err) {
  console.warn('[server] browser init failed (will retry on first /command):', err);
  // don't exit — let server start so HUD still works
}

app.listen(port, () => {
  console.log(`[server] listening on http://localhost:${port}`);
  console.log(`[server] HUD at http://localhost:${port}/  — say "click sign in"`);
});
