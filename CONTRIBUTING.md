# Contributing — HandsFree

Strict git discipline is **non-negotiable** in this repo. Every commit, branch, and tag follows Conventional Commits + SemVer — enforced by hooks and CI. No exceptions.

---

## 1. Commit Message Format (STRICT)

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Types — only these are allowed (commitlint enforces)

| Type       | SemVer | Use                       |
| ---------- | ------ | ------------------------- |
| `feat`     | MINOR  | new feature               |
| `fix`      | PATCH  | bug fix                   |
| `docs`     | —      | docs only                 |
| `style`    | —      | formatting (no logic)     |
| `refactor` | —      | refactor without feat/fix |
| `perf`     | PATCH  | performance improvement   |
| `test`     | —      | tests                     |
| `build`    | —      | build system / deps       |
| `ci`       | —      | CI config                 |
| `chore`    | —      | maintenance               |
| `revert`   | —      | revert prior commit       |

### Scopes — required, only these allowed

```
agent, browser, hud, server, stt, planner, verifier, loop,
highlight, ws, config, deps, docs, repo, ci, release
```

> Scope is **required**. It drives changelogs and `git log --grep`. If none fits, use `repo` and open an issue to add a scope.

### Rules (linted)

- `type` lowercase, required
- `scope` lowercase, required, must be in allowlist
- `subject`: imperative, lowercase start, no period, **≤72 chars**
- `header` total **≤72 chars** (type+scope+subject)
- `body`: wrap at **100 chars**, blank line before body
- `footer`: blank line before footer, `BREAKING CHANGE:` or `Closes #123`

### Examples — copy these

```bash
feat(hud): add interrupt button with abort controller
fix(planner): handle zod parse failure with single retry
docs(repo): define git discipline and branching model
chore(deps): bump playwright to 1.44.1
refactor(loop): extract verification into standalone module
test(verifier): add retry exhaustion test
ci(repo): enforce commitlint on push
feat(planner)!: switch ActionPlan reasoning to structured object

BREAKING CHANGE: ActionPlan.reasoning is now { summary, steps }.
```

### Breaking Changes

Append `!` after scope and add footer:

```
feat(planner)!: change ActionPlan schema to require confidence

BREAKING CHANGE: confidence is now required and must be 0-1.
```

This triggers a **MAJOR** bump via `standard-version`.

---

## 2. How to Commit

**Never `git commit -m "..."` freehand for non-trivial messages.** Use one of:

```bash
# Option A: commitizen (guided prompt, recommended)
npm run commit
# or
npx cz

# Option B: use the template (pre-configured)
git commit          # opens .gitmessage in editor
# or
git commit -v       # with diff

# Option C: manual but linted
git commit -m "feat(hud): add highlight pulse animation"
# hook will reject if it violates rules
```

**Template is auto-configured:** `git config commit.template` points to `.gitmessage`.

---

## 3. Branching Model

```
main                ← protected, always releasable, linear history only
  ↑
dev                 ← integration branch for 2-day prototype
  ↑
feat/hud-overlay    ← short-lived feature branches
fix/planner-zod
chore/deps-bump
```

### Rules

- `main` is **protected**: no direct pushes. PR only, squash merge, linear history.
- `dev` is the daily integration branch during prototype (your `main` until Day 2 freeze).
- Feature branches: `feat/<scope>-<kebab>` / `fix/<scope>-<kebab>` / `chore/<scope>-<kebab>`
  - Examples: `feat/hud-interrupt`, `fix/verifier-retry`, `chore/repo-husky`
- Branch off `dev`, PR back to `dev`. `dev → main` only at milestones (`prototype-freeze`, releases).
- Keep branches **short-lived** (<1 day) — prototype is 2 days, so <4 hours. Rebase often.
- No `git merge` commits in history — use `git rebase` or squash.

```bash
# Start a feature
git checkout dev
git pull --rebase origin dev
git checkout -b feat/hud-overlay

# Keep it fresh (rebase, don't merge)
git fetch origin
git rebase origin/dev

# Push and open PR
git push -u origin feat/hud-overlay
```

---

## 4. History Rules

- **Linear history** on `main` and `dev` — rebase or squash, never merge commits.
- **Atomic commits**: one logical change per commit. Not "wip" or "fix stuff".
- **No `fixup!` / `wip` in shared branches** — squash locally before pushing.
- **No force-push to `main`/`dev`** — only to your feature branch (with care).
- Every commit must **build** (`npm run typecheck` passes) — pre-commit hook enforces.

---

## 5. Hooks (Husky) — What Runs When

| Hook         | What                                                    | Blocks push if fails  |
| ------------ | ------------------------------------------------------- | --------------------- |
| `commit-msg` | `commitlint --edit $1` — validates Conventional Commits | yes (commit rejected) |
| `pre-commit` | `lint-staged` → eslint --fix + prettier on staged files | yes                   |
| `pre-push`   | `npm run typecheck` — no broken types in shared history | yes                   |

**Bypass is disabled by culture, not just tooling.** Never `git commit --no-verify` without a follow-up `fix` commit explaining why.

Install (already done via `npm run prepare`):

```bash
npm install   # also runs husky install via prepare hook
```

---

## 6. Versioning & Tags

- **SemVer** (`MAJOR.MINOR.PATCH`) via `standard-version` (Conventional Commits driven).
- Tags: `v0.1.0`, `v0.2.0`, etc. Annotated tags only.

```bash
# Dry run
npm run release -- --dry-run

# Real release (bumps version, updates CHANGELOG.md, tags)
npm run release

# Breaking change release (MAJOR)
npm run release -- --release-as major
```

**When to tag during prototype:**

- `v0.1.0` — Day 1 E2E working (voice → click)
- `v0.2.0-prototype` or `git tag prototype-freeze` — Day 2 freeze (no more features)

```bash
git tag -a prototype-freeze -m "chore(release): freeze prototype for demo"
git push origin prototype-freeze
```

---

## 7. PR Discipline

- PR title must be a valid Conventional Commit subject (linted in CI).
- PR description: **What / Why / How tested**. Link issue if exists.
- One PR = one scope + one intent. Don't mix `feat(hud)` + `fix(planner)` in one PR.
- PRs squash-merge into `dev` → keeps linear history, one commit per feature in `dev`.

---

## 8. Quick Reference Card

```bash
# Daily flow
git checkout dev && git pull --rebase
git checkout -b feat/<scope>-<name>
# ... code ...
git add -A
npm run commit          # guided
# or git commit -v      # template
git push -u origin feat/<scope>-<name>
# open PR → squash merge → delete branch

# Sync after merge
git checkout dev && git pull --rebase
git branch -d feat/<scope>-<name>

# Emergency fix on dev
git checkout dev
git checkout -b fix/<scope>-<name>
# ... fix ...
git commit -m "fix(<scope>): <imperative subject>"
git push -u origin fix/<scope>-<name>

# Check your last commits
git log --oneline -10
npx commitlint --from HEAD~1 --to HEAD --verbose
```

---

## 9. Enforcement

- **Local:** Husky hooks reject bad commits before they enter history.
- **CI:** `.github/workflows/commitlint.yml` lints every push/PR — fails the build on violation.
- **No exceptions:** If CI is red due to commitlint, the PR is not reviewed. Fix the commit message (`git commit --amend` + force-push to feature branch).

Happy shipping. Keep `main` green, keep history readable.
