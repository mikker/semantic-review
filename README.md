# semantic-review

Semantic diff review for coding agents.

A traditional `git diff` lists files alphabetically and makes you reconstruct the story yourself. `semantic-review` has an LLM read the diff and reorganize it into a narrative: what the change does, grouped by code path and ordered by importance, with the relevant hunks embedded inline — syntax highlighted, selectable, and commentable. When the human reviewer clicks **Done**, their comments are printed to stdout as plaintext, ready to be read directly by the agent that invoked it.

```
agent runs `semantic-review` ──► LLM analyzes the diff ──► browser opens the report
                                                        │
agent reads stdout ◄── plaintext feedback ◄── human comments, clicks Done
```

## Requirements

- [Bun](https://bun.sh)
- One analysis backend:
  - `ANTHROPIC_API_KEY` (or an `ant auth login` profile) for the direct API, or
  - an installed agent CLI: `claude`, `codex`, or `gemini`

## Usage

```sh
bun install

semantic-review                        # review uncommitted changes (git diff HEAD)
semantic-review main...HEAD            # review a branch
git diff -U10 | semantic-review        # review any piped diff
semantic-review --with anthropic,codex # multiple analyses, presented as tabs
semantic-review --no-open              # don't auto-open the browser
```

The command blocks while the review is open in the browser. Stderr carries status (including the local URL); stdout carries only the final plaintext feedback.

## Backends

`semantic-review` is agent-agnostic. The analysis can come from:

| Backend     | How it runs                                     |
| ----------- | ----------------------------------------------- |
| `anthropic` | Anthropic API directly (`claude-opus-5`, override with `SEMANTIC_REVIEW_MODEL`) |
| `claude`    | `claude -p` (Claude Code CLI, its own auth)     |
| `codex`     | `codex exec` (Codex CLI, its own auth)          |
| `gemini`    | `gemini` (Gemini CLI, its own auth)             |

With no `--with` flag, the first available backend is used. With several (`--with anthropic,claude`), each produces its own analysis and the report shows them as tabs — multiple angles on the same change. Comments record which tab they were made on.

## For coding agents

Add something like this to your agent instructions (`CLAUDE.md`, `AGENTS.md`, …):

> After completing a substantial change, run `semantic-review` and wait for it to exit. It opens a review in the user's browser and blocks until they finish. Its stdout is the user's review feedback — treat each comment as a change request and address it.

## Review feedback format

```
Review feedback (2 comments):

1. src/greet.ts:3
   > throw new Error("name required")
   Prefer returning a default over throwing here.

2. § New Ruby helper
   Do we need this at all?

Overall: Looks fine otherwise.
```

Line comments reference `file:line` (new side of the diff); selection comments quote the selected text and reference the nearest line or section. If the reviewer clicks Done with no comments, the output is `Review complete: approved, no comments.`
