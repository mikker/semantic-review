# Evals

Structural scoring of backend/model combinations on real fixture diffs.

```
bun run eval                                              # default backend/model, all cases
bun run eval -- --model claude-sonnet-5 --effort medium
bun run eval -- --with pi --model google/flash evals/cases/tiered-report.diff
```

`run.ts` runs each case through the backend and checks the analysis structurally:
snippet hunk ids exist, line ranges hit real lines, excerpts stay ≤20 lines,
sensible section count, summary length, diagrams look like Mermaid. Each run also
saves the raw analysis and a browsable report to `evals/out/<case>.<backend>-<model>.{json,html}`
(gitignored).

The checks are cheap and comparable across runs, but they can't see shallowness —
a thin analysis can score 7/7 by doing less. Browse the HTML output before trusting
a perfect score.

## Results (2026-07-27)

Cases: `tailwind-restyle` and `tiered-report`, ~450-line diffs from this repo's history.
Score is checks passed per case; time is per case.

| backend / model                | scores    | time/case | qualitative |
| ------------------------------ | --------- | --------- | ----------- |
| anthropic / opus-5 (default)   | 6/7, 7/7  | ~21s      | best balance of depth and restraint |
| anthropic / sonnet-5, medium   | 6/7, 6/7  | ~19s      | close second, slightly overlong snippets |
| claude CLI / haiku             | 6/7, 6/7  | ~70s      | deepest notes but noisy; CLI harness startup dominates time |
| codex CLI / gpt-5.3-codex-spark| 5/7, 6/7  | ~12s      | good judgment, but draws pointless linear-chain diagrams |
| pi / gemini-flash              | 7/7, 7/7  | ~2.5s     | perfect score by doing less — too shallow to be a review guide |

Conclusions:

- Bigger models justify their cost: the small models each fail differently
  (haiku pads, spark decorates, flash under-reads). Default stays `claude-opus-5`.
- Opus is not meaningfully slower than sonnet here (~21s vs ~19s) — generation time
  is dominated by output length, not model size. The real latency cliff is API
  backends (~20s) vs agent CLI harnesses (~70s for claude).
- Known prompt tuning targets: hard cap on snippet length (every model but flash
  ignores "typically 3-12 lines"), stricter diagram rule with a bad example
  (linear A→B→C chains), and a hunk-coverage check to catch shallow analyses.

Gotchas: `gpt-5.1-codex-mini` is rejected on ChatGPT-plan accounts (use
`gpt-5.3-codex-spark`); pi's bare `flash` pattern fuzzy-matches the wrong
provider (use `google/flash`).
