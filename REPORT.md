# REPORT — UX and architecture decisions

## The bet

Agents mostly don't fail by crashing. They fail by believing something wrong and acting on it confidently while the log stays green. So I built the viewer to treat a trace as a record of what the agent believed and when that belief moved, and pushed the plain event log into a secondary role (the raw tab) rather than the main view.

Every decision below comes from that one. It's worth stating up front, because if you don't buy the bet, a lot of the work will look like it's aimed wrong.

## Who I built it for

A strong engineer, tired, looking at a lot of traces in a day, who wants to know where a run went wrong and wants it fast. That one assumption settles most of the UX arguments before they start: density over friendliness, keyboard and click flow over onboarding, no empty-state illustrations, no emoji. If it reads as cold, good. It's a debugger, not a greeting card.

## How it's built

**One normalized schema, and the UI only ever sees that.** Every input format gets converted by an adapter into a single `Trace` type (`src/types.ts`) before anything renders. No component knows or cares whether the source was Claude Code JSONL or OpenAI JSON. Adding a format is one new file in `src/adapters/` plus one line in the registry. The cost is that the schema has to be a superset of every format's ideas, so it carries a pile of optional fields — a real tax, paid on purpose. I'd rather the mess live in a few adapter files than smear format conditionals across the timeline, stats, search, and sparkline.

**Every guessed field is labelled as a guess.** This is the one I'm most attached to. Claude Code JSONL has no per-step duration, OpenAI JSON has no causal links between messages, and neither carries a confidence number. The viewer reconstructs all of that, but each reconstructed value carries a provenance tag (`source` / `inferred` / `unknown`), and the UI dims or dots anything that isn't `source`. A confidence line you can't tell apart from a real measured signal isn't a feature, it's a small liar in a nice colour. The tags are what let me show the inference without pretending it's data.

**Everything degrades instead of throwing.** Paste garbage, an empty file, valid JSON with no steps in it, or a link to a trace this browser has never seen, and each one produces a specific message rather than a stack trace or a blank page. The adapters return a zero-step trace with an explanatory issue instead of raising, and the app treats that as "stay on the landing page and explain." That's the difference between a tool an engineer trusts at 2am and one they close.

**No backend, on purpose.** State lives in React, the URL, and `localStorage`, with traces keyed by a content hash. The honest limitation, which I put in the README rather than hiding, is that a shared link only opens in the browser that loaded the trace, because there's no server holding it for anyone else to fetch. I decided a viewer that works completely offline with zero setup beats half a backend that needs an API key and a deploy to demo. The `Trace`-in/`Trace`-out interface wouldn't change if this grew a real store, so nothing in the viewer would need touching.

## What the UX does about the bet

The baseline timeline, stats, and search are just competent, and competent isn't a point of view. Two features are where the framing actually earns its keep.

The **confidence sparkline** puts one dot per reasoning step above the timeline; sharp drops light up and jump you to the step when clicked. The goal was never an accurate metric. It's that a tired person's eye lands on "something changed here" in about a second, which beats reading the log.

The **failure-hypotheses panel** was the one I kept rewriting the copy on. It generates up to five hypotheses — tool failure, retrieval abandonment, planner oscillation, ignored observations, premature termination — each backed by clickable step-level evidence. The language is deliberately "potential," "signals," "evidence," never "detected" or "root cause." A senior engineer doesn't want a black-box score announcing what's wrong; they want a fast pointer to where to look and the receipts, and they'll make the call themselves. It's all deterministic rules over the trace, no model calls and no embeddings, partly on principle and partly because "the debugger occasionally hallucinates your bug for you" is not a sentence I wanted to defend.

Two smaller calls in the same spirit:

- **Clicking anything jumps and briefly flashes the target** — sparkline points, evidence links, all of it. On a 500-step trace, a selection change with no visible movement feels broken, so the flash makes "yes, that did something, it's up there" unambiguous.
- **Clean traces stay quiet.** The failure-hypotheses panel collapses itself when every mode comes back "none." A panel that spends screen space announcing it found nothing is just noise with a border.

One consistency call worth naming: the "Errors" stat counts steps that render red in the timeline (a tool call goes red when its result failed, not just the result row), rather than a stricter count from the schema. It's a looser definition, but it means the number in the stats bar and the rows you get when you click it to filter always agree. A stat that doesn't match what clicking it shows is worse than one that's technically correct.

## Trade-offs, cuts, and what's next

Some of this was deliberate scope, some is honest roughness, and some is the next thing I'd pick up.

**Cut on purpose.** I built an "interesting events" panel and then deleted it — it listed the same failure evidence chronologically that the hypotheses panel already lists by category, so it mostly showed everything twice in a different hat. Its one unique trick, jump-and-flash, moved onto the evidence links that survived it. Also cut: a backend (above), and branch rendering for multi-choice OpenAI responses (I take `choices[0]` as the one path and keep the rest in the raw document). The larger future ideas — evidence lineage, counterfactual importance, reasoning debt — need a richer trace than today's formats emit, which is why the schema reserves `parent_id`, `refs`, and `meta` so they can be built later without a rewrite. Vision, not vaporware.

**Honestly rough.** The confidence heuristics are directional and I'd never claim otherwise — a UI aid for finding a moment, not a measurement of a model's insides. And the sparkline currently flags drops by comparing raw consecutive steps against a fixed threshold, with no smoothing, so a jumpy signal can produce a jumpy line.

**What I'd do next**, in order: smooth the confidence series so drops read cleanly, then move the heuristic weights behind a small config so someone could tune them without editing source. The first is correctness, the second is polish, which is why it's second.
