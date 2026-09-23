# Task Switching and Cleanup

Use this reference when the main problem is not the task domain itself, but a change in thread state, such as:
- the user inserts a temporary side task
- the user starts a new task after a completed noisy task
- you need to pause one line of work and resume it later
- several active fronts now exist
- the thread is already messy and needs cleanup before continuing
- a finished noisy phase should be summarized and left behind before new work starts

This reference is for **pause/resume, cleanup, and clean continuation**. It is not for repeated similar items or plan-driven execution.

## Three common variants

### Interruption / task switch
Use when you are actively switching away from one line of work and intend to come back.

### Completed-task handoff
Use when a previous task is complete, the user has started a new task or given an explicit next instruction, and the previous task's raw path is noisy enough that it should not be carried into the new work. A request for review, feedback, or an explanation of the completed work is not this handoff.

### Cleanup and continue
Use when the thread is already stale or messy and you want to compress it now, even though context management is being adopted late.

## Working pattern

1. Inspect timeline if anchor choice is unclear.
2. Before switching away or compacting a noisy path, preserve or choose the anchor that will give the resumed/new task a clean working set.
3. If needed, create a backup checkpoint for the current noisy branch.
4. For a new task after a completed noisy task, apply the main skill's compact gate. Low overlap and substantial remaining work favor cleanup; a short lookup or reuse of recent raw material may be cheaper without compaction.
5. If the user asks a concrete side question while noisy mainline work is active, preserve how to resume the active work. Apply the gate across both the side question and the return to mainline, not just what the side question needs.
6. Handle the side task or cleanup move.
7. Compact away the stale path only if the known continuation benefits after recovery costs; a clear handoff summary alone is not sufficient.
8. Resume from the paused anchor or continue from the compacted state.

## Useful anchors

Example checkpoint names:
- `primary-task-paused`
- `migration-mainline-paused`
- `release-investigation-paused`
- `cleanup-pre-noise-anchor`

## When to review timeline

Run `context_timeline` when:
- multiple interruptions happened
- the pause lasted many turns
- several side-task branches now exist
- you are unsure which anchor gives the resumed/new task the right working set
- the thread is already messy and you need to find the right pre-noise checkpoint

## When to compact

Consider compaction under the main skill's gate when:
- the interruption created lots of noise
- the side task is done and should not stay active in full
- the user begins a new task after a completed noisy task and the previous raw path is no longer useful in full
- a stale path is making current reasoning worse
- the useful state is now much smaller than the accumulated process
- you can express the handoff clearly in a summary

Do not compact at the instant you finish a user-visible task if there is no known continuation. In that moment, deliver the answer and wait, retaining the raw trail for review, feedback, or questions about the work. If a later user message starts a new task or establishes an explicit next phase, that is the right time to decide whether compacting the completed task helps before proceeding. If the completed task changed files, browser state, tickets, or remote services, include those side effects in the handoff summary because the context move does not undo them. If the interruption was tiny and clean, a compact may be unnecessary. A checkpoint before switching away is still the key move.

## Common mistakes

Avoid:
- switching away without a pause checkpoint
- compacting immediately after a final answer just because the task completed
- carrying a large obsolete task trail into a long continuation that would benefit from cleanup
- discarding recent useful raw material for a short side task, then rebuilding it on return
- trying to clean up without first checking timeline when anchor choice is unclear
- resetting past still-valid near-term context without carrying it in the summary
- forgetting that files and external systems remain in their latest state after context navigation
