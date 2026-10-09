# HandsFree

Voice-controlled browser automation.

New machine? Start at [SETUP.md](./SETUP.md) (Windows + Scoop one-command setup).

## Quick start

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — start server with watch
- `npm run build` — compile TypeScript
- `npm run typecheck` — type check without emit
- `npm run lint` — run ESLint
- `npm run format` — check formatting
- `npm run format:fix` — fix formatting
- `npm run commit` — guided conventional commit

## Git discipline

This repo enforces Conventional Commits. See [CONTRIBUTING.md](./CONTRIBUTING.md).

- `feat(scope):` — new feature
- `fix(scope):` — bug fix
- Required scope: `agent, browser, hud, server, stt, planner, verifier, loop, highlight, ws, config, deps, docs, repo, ci, release`

Commit via `npm run commit` or `git commit` (template configured).

## Project structure

```
src/
  server.ts        — Express + WebSocket + Playwright lifecycle
  agent/           — planner, verifier, loop
  browser/         — launch, highlight, hud injection
  hud/             — overlay UI + speech
```

## License

MIT
