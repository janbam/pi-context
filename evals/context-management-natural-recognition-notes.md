# Context Management Natural Recognition Eval Notes

This set uses realistic user wording and scores recognition by mode-signal evidence instead of requiring immediate tool invocation or reference reads.

## What this set tests

1. **Natural mode recognition**
   - Does the agent recognize that the task shape fits context-management, even if the prompt still lacks enough concrete input to begin real work immediately?

2. **Recognition without over-triggering**
   - Can the agent distinguish operational cleanup from simple summaries or direct edits?
   - Concept/method discussion about keeping long conversations clear may read the skill or use lightweight tools, but should not perform structural cleanup such as `context_compact` when the user explicitly says not to operate.

## How to interpret

A prompt in this set can be a successful positive even if the agent does not immediately call `context_checkpoint` or read a reference file, as long as it clearly signals the right working mode and asks for the next concrete inputs in a way consistent with that mode.

The automated runner treats positive cases as passed when there is evidence of both:
- context-management recognition, either via context tool usage, skill/reference reads, or explicit text about context/checkpoint/timeline/compact-style management
- the expected scenario mode, either via the expected reference read or final text matching that mode's aliases

Negative summary/direct-edit cases should remain non-operational: no context tools, no skill read, and no reference reads. Concept/method cases are allowed to consult the skill, but must not compact or rewrite the active conversation structure.
