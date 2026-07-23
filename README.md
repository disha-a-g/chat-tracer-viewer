# Chat Trace Viewer

A viewer for AI agent traces. It treats a trace as a record of what the
agent believed and when that belief changed, not just a log of events, so
you can find where a run went wrong instead of scrolling through everything
it did.

Runs entirely in the browser. No backend, no database, no API keys.

**[Live demo](https://disha-a-g.github.io/chat-tracer-viewer/)**

- **[ideas.md](./ideas.md)** — the thinking behind it.
- **[REPORT.md](./REPORT.md)** — the UX and architecture decisions.

## Install & run

Requires Node `^20.19.0` or `>=22.12.0`.

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # typecheck + production build to dist/
npm run preview   # serve the production build
npm test          # run the test suite
npm run lint      # oxlint
```

19 Vitest files cover every adapter and every `src/lib/` module. CI
(`.github/workflows/ci.yml`) runs lint, build, and test on every push and PR.

## Loading a trace

From the landing page: paste JSON/JSONL, upload a `.json`/`.jsonl` file,
fetch a URL, or load one of the bundled examples. Every path runs through the
same detect-and-parse pipeline, so examples aren't a special case — each
example is a real, unmodified trace file, not pre-normalized JSON.

### Example traces

| Example | Format | What it shows |
|---|---|---|
| OpenAI — revenue query gone wrong | OpenAI chat completions | A failed SQL query retried unchanged, then a fabricated answer with no error raised. |
| Generic JSON — PHI pipeline run | Generic JSON (no native trace format) | A stdout-driven NER pipeline reconstructed from its own logs, run end to end with no failures. |
| Claude Code — DMLS build, chasing a file lock | Claude Code JSONL | A real public session from the [trace-commons/agent-traces](https://huggingface.co/datasets/trace-commons/agent-traces) dataset on Hugging Face: 743 steps, 58 tool errors, ends mid-fight with a Windows linker file lock the agent never escapes. |
| Claude Code — multiboot2 UEFI/GOP upgrade | Claude Code JSONL | Also from trace-commons/agent-traces: 574 steps upgrading an OS kernel's boot path to UEFI GOP graphics — hits a real failure partway through, then recovers. |

### Connectors (format adapters)

The format is detected automatically. You never have to say what you pasted.

| Format | Adapter |
|---|---|
| Claude Code JSONL (`~/.claude/projects/**/*.jsonl`) | `src/adapters/claude-code.ts` |
| OpenAI chat completions (request or response) | `src/adapters/openai.ts` |
| Generic JSON — any document with an array of step-like objects | `src/adapters/generic.ts` |

Adding a format is one new file in `src/adapters/` and one line in the
registry. Nothing else in the app knows what format a trace came from — it
all reads one normalized `Trace` type (`src/types.ts`).

## Features

- **Timeline** — virtualized so 10k-step traces stay smooth, color-coded by
  status, steps expand to show tool input and output.
- **Detail pane** — full content, formatted JSON, errors, and the confidence
  breakdown for any step, with a parsed/raw toggle. A separate tab shows the
  whole original document.
- **Stats** — duration, steps, tool calls, errors, tokens. Click the error
  count or a status to filter the timeline.
- **Search** — across content, tool names, input, output, and errors, with a
  live match count.
- **Confidence sparkline** — one point per step, sharp drops highlighted and
  click-to-jump, so your eye lands on where confidence fell.
- **Failure hypotheses** — surfaces up to five likely failure modes, each
  backed by clickable step-level evidence. Points you at where to look; it
  doesn't claim a verdict.
- **Loop detection** — repeated near-identical tool calls collapse into one
  "loop detected" row.
- **Failure summary** — a one-line banner on failed traces saying what broke
  and whether the agent recovered, retried, or gave up.
- **Annotations** — leave a note on any step; it renders inline and travels
  in the shareable link.
- **Shareable links** — deep-link to a specific step. Trace state lives in
  the URL and `localStorage`, and browser back/forward works like real
  navigation.
- **Notebook tab** — record custom failure modes with your own evidence,
  kept across traces.
- **Recent traces** — the last five you loaded, one click to reopen.

Malformed, empty, and huge traces all get a clear message instead of a crash.

## Note on shared links

Persistence is `localStorage` plus the URL, so a shared link only opens in
the browser that loaded the trace. It's a deliberate scope choice — the app
works fully with no server — and it's the first thing a backend would fix.

## A note on AI usage

I used Claude (Claude Code) as a pair-programmer throughout this project,
most heavily for the UI — component layout, styling, and interaction
details were largely built and iterated on with it. The core ideas (the
epistemic-history framing in `ideas.md`, the normalized trace schema, the
failure-taxonomy heuristics, and the architecture decisions in
`REPORT.md`) are mine; AI helped me implement and refine them, not
originate them.
