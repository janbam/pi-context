# Context Management Borderline Eval Notes

This eval set is designed to reveal whether the current skill teaches the intended working rhythm, not just whether it causes any context tool to appear.

The target rhythm is:
- checkpoint early and often
- review timeline when orientation matters
- compact only when a phase is ready to compact

## What this set is trying to test

### 1. Bounded multi-file reading should stay lightweight
Prompts 1-2 are intentionally multi-file, but still bounded and summarization-oriented.

Goal:
- detect over-triggering
- verify the agent does not treat every multi-file read as a long-running history-management problem

### 2. Medium debugging should escalate only when needed
Prompts 3-4 are not trivial, but they also should not force a heavy workflow immediately.

Goal:
- see whether the agent can start light
- then introduce checkpoint/timeline only if the thread begins to get messy
- distinguish intelligent escalation from knee-jerk tool use

### 3. Repeated-item requests with workflow uncertainty
Prompts 5-6 are the most important workflow-selection cases.

They are not simple "many items => trigger" prompts.
The agent must first decide:
- is this really a direct scripting task?
- or is representative investigation needed before repeated execution?

Goal:
- reward agents that understand workflow selection, not just keyword matching

### 4. Concept discussion should not operationally trigger
Prompts 7-8 mention context-management ideas directly, but the user only wants analysis.

Goal:
- confirm the skill does not hijack conceptual conversations
- protect against over-trigger caused by topic overlap

### 5. Positive prompts should imply different tool intensity
Prompts 9-11 are all positive, but should not all look the same.

Desired gradient:
- Prompt 9: checkpoint only
- Prompt 10: timeline first, then decide
- Prompt 11: must eventually compact

Goal:
- test whether the agent chooses the right level of intervention, not just whether it uses any context tool

### 6. Interruption readiness is a real positive case
Prompt 12 checks whether the agent recognizes subtask switching as a checkpoint-worthy scenario.

Goal:
- verify that interruption-prone work triggers the mode
- confirm the likely move is checkpoint-first, not premature compact

### 7. Compact is the core behavior to verify
Prompts 11, 13, and 14 are the most important cases in this set.

Goal:
- verify that the agent does not stop at checkpointing forever
- verify that when a noisy phase is actually complete, it performs a compact back to a cleaner anchor
- allow `context_timeline` before `context_compact` if the agent wants to confirm the correct anchor first

### 8. Mild clutter should not cause premature compact
Prompt 15 is the brake pedal.

Goal:
- verify that the agent can distinguish "some clutter" from "phase ready to compact"
- checkpoint should be enough here

## Suggested evaluation dimensions

When you run this set, score each response on at least these dimensions:

1. **Trigger correctness**
   - Should it have engaged context-management behavior at all?

2. **Action proportionality**
   - Did it pick the right level of intervention?
   - Example: using `context_compact` too early should count against it.

3. **Workflow selection quality**
   - Especially for prompts 5-6, did it correctly decide between direct automation and representative-case exploration?

4. **Concept-vs-operation separation**
   - For prompts 7-8, did it stay explanatory rather than operational?

5. **Interruption handling awareness**
   - For prompt 12, did it recognize that a checkpoint may be useful before any interruption actually happens?

## Recommended next run matrix

For this eval set, the most informative matrix is:

1. `old_ext_old_skill`
2. `new_ext_old_skill`
3. `new_ext_new_skill`
4. `new_ext_no_skill`

When reviewing, do not stop at "used a context tool or not".
Also compare:
- which specific tool was chosen first
- whether the agent escalated too early
- whether it checkpointed proactively before mess
- whether it used `context_timeline` for orientation at the right time
- whether it used `context_compact` only when justified

## Expected likely outcomes

If the redesign is better, you should expect:
- fewer unnecessary triggers on prompts 1-2 and 7-8
- better escalation behavior on prompts 3-4
- better workflow selection on prompts 5-6
- more proportional tool choice on prompts 9-11
- better checkpoint-first behavior on prompt 12
