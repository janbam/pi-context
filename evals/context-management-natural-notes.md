# Context Management Natural Eval Notes

This eval set is intentionally phrased more like real user requests and less like skill-aware test prompts.

## What this set tests

1. **Natural triggering**
   - Does the skill trigger from realistic task descriptions without explicit mentions of checkpoints, timeline, compact, or context management terminology?

2. **Natural reference routing**
   - Does search / browser / webpage reading route into `search-research-and-reading.md`?
   - Does dev + try-several-directions route into both `development-and-troubleshooting.md` and `retry-branch-and-pivot.md`?
   - Do plan / repeated-items / switching / cleanup tasks route into their expected refs?

3. **Over-trigger resistance**
   - Simple summaries, direct edits, and concept-only discussion should stay out.

## Interpretation guidance

This set is a stronger test of real-world behavior than the more explicit trigger / ref-routing evals, because the prompts describe task shape indirectly instead of instructing the skill what to do.
