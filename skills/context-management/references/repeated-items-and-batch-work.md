# Repeated Items and Batch Work

Use this reference when the work involves many similar items handled over many turns, such as:
- repeated cases
- repeated tickets
- repeated reviews
- repeated checks
- repeated fix attempts on similar inputs

Use this reference when the items are similar enough that the same method should be reused across them. If the subtasks are heterogeneous and anchored to a roadmap or todo baseline, use `planning-and-execution.md` instead.

## Working pattern

1. Create a checkpoint at the start of the overall repeated-item task.
2. If item 1 teaches you a reusable approach, checkpoint again after that approach becomes clear.
3. Work item by item.
4. Between items, apply the main skill's compact gate. Compact only when item-specific noise is worth removing after accounting for shared raw examples, methods, or code needed by the remaining items.
5. Use timeline occasionally to verify that the history still has a clean structure.

An item boundary is not an automatic cleanup step. If the next items compare against the same examples or edit the same code, retain that shared raw working set. If completed items left substantial unrelated noise, compact to a baseline that preserves the reusable method and necessary examples. If the last item completes the whole user request, deliver the final answer and retain the raw trail for review or feedback; decide whether to compact only after a later message establishes new work or an explicit next phase.

## Useful anchors

Example checkpoint names:
- `vendor-review-start`
- `vendor-review-method-clear`
- `ticket-triage-batch-start`
- `ticket-triage-pattern-1-confirmed`

## When to review timeline

Run `context_timeline` when:
- several items have already been processed
- item-level work has created multiple branches or compactions
- you want to confirm that the overall pattern still looks clean
- you are about to choose which anchor repeated work should keep returning to

## When to compact

Consider compaction, subject to the main skill's gate, after:
- a representative item produced a reusable method and the batch will continue
- an item is complete, more work remains, and its raw trail is no longer needed for comparison or reuse
- an item-specific dead end is understood and should not remain active in full
- a new user message arrives after the batch completed, and the batch's raw path is stale baggage for the new task

## Example rhythm

```javascript
context_checkpoint({ name: "vendor-review-start" });

// ... work through first representative item ...

context_checkpoint({ name: "vendor-review-method-clear" });

// ... process another item ...

context_compact({
  target: "vendor-review-method-clear",
  summary: "Current task: continue the vendor review batch. State: one more vendor review is complete; item-specific reasoning no longer needs to stay raw. Reusable method remains the active baseline. Next step: process the next vendor using the same method.",
  backupCheckpoint: "vendor-review-item-7-history"
});
```

## Warning signs

Use stronger checkpoint/timeline/compact discipline when:
- each item creates lots of local reasoning
- you are starting to confuse one item's path with another's
- the repeated work is stretching across many turns
