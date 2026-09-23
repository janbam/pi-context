# Development and Troubleshooting

Use this reference for long-running:
- implementation
- debugging
- troubleshooting
- refactoring
- migration
- review or audit work

These tasks often stay cleaner when treated as stages with anchors, instead of one uninterrupted thread. If multiple alternative approaches, failed branches, or route comparisons become central, also read `retry-branch-and-pivot.md`.

## Working pattern

1. Create a checkpoint before starting serious work.
2. Add checkpoints before risky edits, new approaches, or major phase changes.
3. Review the timeline when you need to understand the current shape of the work.
4. At a stable milestone, evaluate the main skill's compact gate. Keep the shared raw working set when the next fix, test, or review still needs it; compact only when removing the stale trail is worthwhile after recovery costs. If files, processes, or external systems changed, include those side effects in the summary because context navigation does not roll them back. If the completed phase is the final user-visible deliverable, present it and wait for feedback or the next instruction; do not compact merely because you asked for review.

## Typical checkpoint moments

Checkpoint:
- before starting implementation
- before a risky refactor
- before trying an alternative fix
- after a milestone like "root cause confirmed" or "first pass implemented"
- before switching to a side task

Example checkpoint names:
- `parser-fix-start`
- `cache-refactor-attempt-2`
- `migration-plan-ready`
- `incident-root-cause-confirmed`

## Timeline review moments

Run `context_timeline` when:
- multiple attempts now exist
- the task moved from diagnosis to implementation
- you are about to abandon one approach and restart from another anchor
- you are unsure which checkpoint best represents the clean continuation point

## Compact patterns

### After a failed attempt

Use compact when an attempt clearly failed, its useful lesson fits a crisp summary, and the replacement approach does not need the raw failed trail. If you are about to diagnose the same error or repair the same code, retain those details.

```javascript
context_compact({
  target: "memory-leak-fix-start",
  summary: "Current task: continue the memory leak fix. State: WeakRef approach failed because objects were collected too early and cache hit rate collapsed. Decision: abandon WeakRef and try object pooling. Next step: implement the object-pooling approach.",
  backupCheckpoint: "memory-leak-weakref-raw-history"
});
```

### After a completed phase

Use compact when a phase is done and a known next phase would work better from a focused state summary than from the raw implementation/debugging trail. Do not use this as a reflexive final step before or after delivering finished work: preserve the needed patch and evidence while awaiting review, feedback, or a decision. Separate cold monitoring history may still be removable when another known continuation passes the gate. Compact only when validation, a next phase, a next attempt, or a newly received user task makes the continuation concrete.

```javascript
context_compact({
  target: "parser-fix-start",
  summary: "Current task: validate the parser fix. State: implementation is done and the debugging trail can be summarized. External state: parser implementation and related tests were changed on disk; context navigation did not revert them. Validation not yet run after final edit. Next step: run targeted validation and summarize remaining edge cases.",
  backupCheckpoint: "parser-fix-debug-history"
});
```

### When the next phase still needs the raw material

- **Diagnosis -> fix:** the cause is confirmed, but the next edit uses the function and failing test just read. Continue with those raw details; the stable diagnosis alone is not a reason to compact.
- **Core -> integration:** local tests pass, but the next changes touch the bridge/runtime files already loaded. Treat these as one shared working set rather than compacting at every module boundary.
- **Implementation -> review feedback:** a reviewer is examining the same patch. Usually retain the patch and evidence while waiting and handling local revisions. A long accumulation of stale monitoring output may still pass the compact gate.
- **Failed search -> different approach:** many rejected logs and searches can become a short lesson, and the next approach needs only that lesson and a known command. This is a stronger candidate for compaction.

## Warning signs

Switch into stronger context-management behavior when:
- you are accumulating many partial theories
- the thread contains multiple fix attempts
- you keep revisiting earlier reasoning
- the next step is clear but the path behind it is getting noisy
