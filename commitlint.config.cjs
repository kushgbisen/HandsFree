/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ["@commitlint/config-conventional"],
  // strict semantics: type + scope required, no loose commits
  rules: {
    // types — exhaustive
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"],
    ],
    "type-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],

    // scope — REQUIRED, strict allowlist for this repo
    "scope-enum": [
      2,
      "always",
      [
        "agent",
        "browser",
        "hud",
        "server",
        "stt",
        "planner",
        "verifier",
        "loop",
        "highlight",
        "ws",
        "config",
        "deps",
        "docs",
        "repo",
        "ci",
        "release",
      ],
    ],
    "scope-case": [2, "always", "lower-case"],
    "scope-empty": [2, "never"],

    // subject
    "subject-case": [2, "never", ["pascal-case", "upper-case"]], // must start lowercase
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 72],
    "header-min-length": [2, "always", 10],

    // body
    "body-max-line-length": [2, "always", 100],
    "body-leading-blank": [2, "always"],

    // footer
    "footer-leading-blank": [2, "always"],
    "footer-max-line-length": [2, "always", 100],
  },
  helpUrl: "https://github.com/conventional-changelog/commitlint/#what-is-commitlint",
};
