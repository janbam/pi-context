# Context Management Description Status

This file records the **current chosen description** and the evaluation focus for the latest skill design.

The skill has been redesigned around a conversation-management working mode:
- frequent checkpoints
- periodic timeline review
- targeted compactions as the task evolves

It is **not** centered on file-backed durable state, queue files, or Git-confusion guardrails.

## Current chosen description

```yaml
description: Read this skill for long, noisy, multi-phase, or otherwise complex work that is likely to spread across many turns. Especially use it for searching, research, reading lots of files/logs/docs/web results, troubleshooting, implementation, refactoring, migration, planning-and-execution, review/comparison/audit work, repeated similar items, or switching between subtasks. It teaches a working mode built around frequent checkpoints, periodic timeline review, and targeted compactions as the task evolves. Usually skip it for one-shot reads, bounded summaries, direct rewrites, or deterministic scripts.
```

## What the next eval round should test

Focus on whether the skill now teaches the intended rhythm:

1. **Frequent checkpointing**
   - Does the agent proactively create stable anchors before messy phases?

2. **Timeline review at the right moments**
   - Does the agent reach for `context_timeline` when orientation matters, instead of either ignoring structure or overusing it?

3. **Targeted compactions, not premature compactions**
   - Does the agent compact only after a phase has produced a stable result, lesson, or dead-end summary?

4. **Action proportionality**
   - For light positives, does it choose checkpoint-only or timeline-first instead of jumping straight to compact?

5. **Scene coverage**
   - Does it trigger across search-heavy work, multi-phase work, retries/branches, repeated-item work, and interruption-prone work?

## What older eval assumptions are now stale

These should no longer be treated as central evaluation themes:
- queue / SOP / results must live in files
- "history is not the database"
- control-plane vs execution-plane language
- Git-overlap resistance as a primary optimization target

A Git-themed negative example can still exist as a normal conceptual negative, but it is no longer a design center.
