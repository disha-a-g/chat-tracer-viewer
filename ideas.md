# Chat Trace Viewer: design & reasoning

## How I got here

The first time I really needed a trace viewer, I opened one and realized it was answering a question I didn't have. It could tell me every request, every span, every latency number. What it couldn't tell me was why the agent had confidently done the wrong thing for six steps in a row without ever erroring.

That stuck with me. The tooling I had was built for debugging services, and services fail in obvious ways. They throw, they time out, they 500. Agents mostly don't. The failures I kept running into were quieter than that. The agent picks a direction and commits to it. It reruns the same idea expecting a different result. It reads a tool result that should have stopped it cold and just keeps going. Nothing turns red. The run is green the whole way down and the answer is still wrong.

So the reframe I kept coming back to: a trace is less an execution history and more an epistemic one. An execution history tells you what happened and when. An epistemic history tells you what the agent believed, what made it believe that, when the belief changed, and which belief is the one that actually sank the run. Same events, different question. Once I started looking at traces that way, the tool more or less designed itself, and this is that tool.

## Who this is for

I'm building for the version of me that's six traces deep on a bad afternoon. An engineer with a trace open because a run failed, or succeeded in a way that smells off, or cost three times what it should have, who needs to know where it went sideways and why, and needs it fast because there are a dozen more traces behind this one.

That person is technically strong and short on time. They don't want hand-holding, they want density, fast search, and to not fight the tool. I'd rather this feel like a debugger than a dashboard. No warmth budget spent on empty states nobody reads.

## What I'm optimizing for

1. Every step is a decision, not just an event. What did the agent know here, what did it pick, what did that get it.
2. You find a failure by walking backward from the symptom to the decision behind it, not by scrolling forward through the whole log hoping to spot it.
3. There are three honest ways to read a trace: a quick summary, the decision timeline, and the raw JSON. Moving between them should be cheap.
4. Which format someone pasted is not their problem. The tool figures it out.
5. Sharing one specific step is a single click, not a screenshot.

## The two ideas I care most about

Everything else on the page is just the basics. These two are where the epistemic framing actually shows up as something you can click.

**A confidence drift line.** A small sparkline above the timeline tracking a rough proxy for the agent's confidence across the run, with sharp drops that jump you to the step where they happened. If the trace carries a real confidence signal I use it; most don't, so I fall back to cheap tells like message length collapsing, tool calls suddenly stopping, or the agent thrashing between hypotheses. I want to be upfront that this isn't a precise measurement, and it doesn't need to be. It needs to get a tired person's eye onto the moment something changed in about a second. A rough signal does that fine. A precise one wouldn't do any better.

**Annotations that travel.** Leave a comment on any step; it renders inline and rides along in the shareable link. Right now debugging findings get passed around as a sad little chain of screenshots and Slack messages. This replaces that with a link to the exact step, already annotated. Of all the complaints I've heard about debugging agents, "I can't easily show someone what I found" is one of the most consistent, and it's almost embarrassingly cheap to fix.

Both come back to the same idea: the thing you're debugging is a decision, not a log line.

## Where this could go

None of this is built yet, but it all falls out of the same framing, and I want it on the record because the framing is the point.

- **Evidence lineage.** For any claim the agent makes, walk back through the retrievals, prompts, and goals that produced it. "Where did this come from," not just "when was it said."
- **Epistemic loop detection.** Catch the agent circling the same hypothesis without new evidence. Not an infinite loop in the CS sense, a reasoning one.
- **Forgotten evidence.** Flag a retrieval used once and then dropped, and the opposite: one piece of evidence leaned on so hard everything else gets ignored.
- **Counterfactual importance.** Find the single decision whose reversal would have changed the most downstream steps. SHAP values, roughly, but for reasoning.
- **Decision half-life.** How long a decision survives before it's overturned. The ones that die fast tell you something about how stable the planner is.
- **Reasoning debt.** By analogy to tech debt: assumptions never resolved, beliefs that contradict each other, conclusions never checked. A running tally per trace and per agent version.
- **Reviewer mode.** For someone skimming many traces, show the pivotal moments as a short narrative instead of the full log. Closer to reading a PR review than the diff.
- **Cross-run patterns.** If a specific tool or prompt or planner version fails far more than the rest, say so when the trace loads. Debugging one run shouldn't depend on remembering the last twenty.
