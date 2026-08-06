<img src="semantic-review.webp" width="452">

# semantic-review

> Tell me that again but _slowly_...

Semantic diff review for coding agents.

Install the bundled agent skill:

```sh
npx skills add mikker/semantic-review
```

An LLM reads a git diff and reorganizes it into a **narrative HTML report** — grouped by concern, not alphabetically, with the interesting excerpts inline, highlighted and commentable. When the reviewer clicks **Done**, their comments print to `stdout` as plaintext for the agent that invoked it.

```
agent runs `semantic-review` ──► LLM analyzes the diff ──► browser opens the report
agent reads stdout ◄── plaintext feedback ◄── human comments, clicks Done
```

Requires Node >= 20 (or [Bun](https://bun.sh)) and one backend: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or an installed `claude`, `codex`, `gemini`, or `pi` CLI.

```sh
npx semantic-review
```


Run it like `$ git diff`:

```
semantic-review                        # review uncommitted changes
semantic-review main...HEAD            # review a branch
git diff -U10 | semantic-review        # review any piped diff
semantic-review --with anthropic,codex # one analysis per backend, tabbed
semantic-review --with openai          # use the OpenAI API
semantic-review --model claude-sonnet-5 --effort medium
# Generate a prompt, then render caller-provided analysis
semantic-review --emit-prompt > prompt.txt
semantic-review --analysis analysis.json
```

## Preferences

Put user defaults in `~/.config/semantic-review/config.json` (or
`$XDG_CONFIG_HOME/semantic-review/config.json`). Command-line options override
them. For example, to always use the Codex CLI by default:

```json
{
  "backend": "codex"
}
```

`backend` may also be an array for a multi-backend review. The other supported
settings are `model` and `effort`.

Try it with your agent:

> Run `npx semantic-review` and wait for it to exit. Its `stdout` is the user's review feedback — treat each comment as a change request and address it.

## Agent skill

The skill analyzes the diff in an isolated context by default, keeping implementation history out of the review:

```text
/semantic-review
```

Describe a preferred harness or model naturally to launch an independent sidecar instead:

```text
/semantic-review use Claude Code with fable
/semantic-review run this through Codex using gpt-5.3-codex-spark
/semantic-review use google/gemini-2.5-pro through Pi
```

The skill is deliberately user-invoked only. Claude Code runs it in a foreground fork with no conversation history; other agents prefer an isolated same-harness sidecar and fall back to host analysis only when isolation is unavailable.
