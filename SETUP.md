# HandsFree — Setup Guide (Windows + Scoop)

Repo: **https://github.com/kushgbisen/HandsFree** (public, default branch `dev`).
Product = the Chrome extension in `extension/`. The Node server in `src/` is a frozen demo harness.

You need: Windows 10/11, PowerShell, internet. No admin rights needed (Scoop installs per-user).

## A. Bootstrap a bare machine (no git yet)

Open PowerShell and paste this block. It installs Scoop + Git, then clones the repo:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
irm get.scoop.sh | iex
scoop install git
git clone -b dev https://github.com/kushgbisen/HandsFree.git "$HOME\HandsFree"
```

Close and reopen PowerShell afterwards (PATH refresh).

## B. Full setup (one command)

```powershell
cd "$HOME\HandsFree"
.\setup\setup-all.ps1
```

This runs, in order:

| Script                           | Does                                                           |
| -------------------------------- | -------------------------------------------------------------- |
| `setup/00-install-tools.ps1`     | Scoop, Git, Node.js LTS (>= 20), Chrome — skips what's present |
| `setup/01-clone-and-install.ps1` | Clone/update + `npm ci` + create `.env` from `.env.example`    |
| `setup/02-verify.ps1`            | Node version, extension typecheck, eslint, file completeness   |

Each script also runs standalone. Re-running is always safe.

## C. API key

1. Free key: https://aistudio.google.com/app/apikey
2. Paste into `.env`: `AISTUDIO_API_KEY=...`
3. Same key goes into the extension popup (step D).

## D. Load the extension in Chrome

1. `chrome://extensions` → enable **Developer mode** (top right)
2. **Load unpacked** → select `<clone>\extension` (the folder containing `manifest.json`)
3. Pin HandsFree to the toolbar
4. Click the toolbar icon → provider `aistudio`, model `gemini-3.1-flash-lite`, paste key → **Test** (must go green) → **Save**
5. Open any site, allow the mic when asked (per-site, asked once)

## E. First run

Type in the pill (not mic — removes a variable): `search for cats`.
Expect: results page in ~4–6 s, `✓` on the pill, timings in the think line
(`scan … · think … · act …`). Then tap the mic — it must say `Listening…`.

## Daily workflow

```powershell
git pull            # stay current (dev branch)
npm ci              # only when package-lock.json changed
```

After pulling code changes: `chrome://extensions` → ⟳ reload HandsFree, then
`Ctrl+Shift+R` the test tab. If you edit `extension/src/*.ts` yourself:
`npx tsc -p extension/tsconfig.json` (emits the committed `.js` mirrors),
then reload the extension.

Commits follow Conventional Commits (`npm run commit` guides you).
Branch: work on `dev`.

## Troubleshooting

| Symptom                               | Fix                                                          |
| ------------------------------------- | ------------------------------------------------------------ |
| `scoop`/`git`/`node` "not recognized" | Open a NEW terminal (PATH), or re-run `setup-all.ps1`        |
| Script won't run (execution policy)   | `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force` |
| `npm ci` fails                        | Node >= 20 required; re-run `00-install-tools.ps1`           |
| Pill says key rejected                | Popup → Test → Save; same key must be in `.env`              |
| Pill dead after extension reload      | `Ctrl+Shift+R` the tab (content script is per-load)          |
| Port 3000 in use (`npm run dev`)      | Old server still running — kill it, only one at a time       |
