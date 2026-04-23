# Bug Report: Undocumented Off-Path Summary Rendering in `context_log`

**Current HEAD:** `ddb5fc43`

## What Happened (Reconstruction)

We conducted a deep-dive Q&A about the pi-context extension. The agent then checked out from the deep-dive branch back to the user's first message (`a941c0e5`), leaving a summary and `backupTag: pi-context-deep-dive-raw`. This created a new branch starting at `a941c0e5` with summary node `e6f678a5`.

The user had a few turns on this new branch, then checked out back to `pi-context-deep-dive-raw` (the original messy branch). When the agent ran `context_log` on the returned-to branch, it saw this backbone:

```
root → a941c0e5 → e6f678a5 (SUMMARY, tag: pi-context-deep-dive-raw) → ... → c76b3c0f (tag: pi-context-deep-dive-raw) → ...
```

**The confusion:** `e6f678a5` is a `branch_summary` node created on a **sibling branch** during the first checkout. It is NOT on the current branch path. Yet it appears interleaved in the backbone output of `context_log`, between `a941c0e5` and the next node, with no visual indication that it belongs to a different timeline. The agent mistakenly believed this was a bug in tree navigation or that the checkout had failed to create a proper branch.

## Root Cause

The `context_log` tool intentionally pulls **all** off-path `branch_summary` and `compaction` children for every backbone node:

```javascript
// src/index.ts, inside context_log tool
const children = sm.getChildren(entry.id);
children.forEach((child) => {
    if ((child.type === "branch_summary" || child.type === "compaction") && !backboneIds.has(child.id)) {
        sequence.push(child);  // renders as part of the visible backbone
    }
});
```

This behavior is **not mentioned** in:
- The `context_log` tool's `description` field
- The `context-management` skill (`SKILL.md`)
- Any documentation the agent has access to

## Why This Is a Problem

1. **Agents have no mental model for it.** The skill teaches that `context_log` is analogous to `git log --graph --oneline --decorate`. In Git, `git log` shows only the current branch (or explicitly specified refs). Seeing unrelated merge commits from sibling branches interleaved into the output is unexpected.
2. **Visual ambiguity.** Off-path summaries use the same `[SUMMARY]` role marker as backbone summaries. There is no prefix like `(sibling branch)` or indentation to distinguish them. They look like they belong to the current timeline.
3. **It scales badly.** Every checkout creates a new `branch_summary`. Over a long session with many branches, the `context_log` output accumulates orphaned summaries from every parallel universe, polluting the HUD and making it harder to read the actual current branch.
4. **It undermines trust.** When an agent sees a node on the backbone that it knows it created on a *different* branch, it assumes the tree navigation failed — leading to confusion, unnecessary debugging, and wasted turns.

## The Actual Bug

**The bug is not the rendering code.** The bug is that this behavior is **completely undocumented** in the places where agents form their mental model:

- The `context_log` tool description says: *"Show the entire history structure (status, message, tags, milestones). Analogous to 'git log --graph --oneline --decorate'"* — but does not mention that it also renders off-path summaries from sibling branches.
- The skill file says: *"See where you are." / "Check the Graph: Where are you? Are you in a deep branch?"* — but never explains that "the graph" includes parallel-timeline breadcrumbs.

## Suggested Fix

**Option A: Document it.**

Update the `context_log` tool description and the skill to explicitly state:

> "`context_log` shows the current branch path plus any `branch_summary` or `compaction` nodes from sibling branches that share an ancestor with the current path. These off-path summaries are rendered inline and may appear to be part of the current branch. They are preserved as breadcrumbs to parallel timelines but can be ignored if you are focused on the current branch only."

And add to the skill's "Context Health Check":

> "Seeing `[SUMMARY]` nodes that don't match your current task? Those are breadcrumbs from sibling branches created by previous checkouts. Only nodes marked `HEAD` or on the direct path between `ROOT` and `HEAD` are your current branch."

**Option B: Change the rendering.**

If the intent is truly "show breadcrumbs," render them differently:
- Group off-path summaries at the bottom under a `--- Sibling Branch Summaries ---` header
- Or prefix them with a visual marker like `~` or `(off-path)`
- Or only show off-path summaries from branches created within the last N backbone nodes, rather than all ancestors

**Recommendation:** Do **Option A** immediately (it's a docs fix, zero risk). Consider **Option B** as a follow-up UX improvement.


---

session file: ~/.pi/agent/sessions/--home-jan-work-pi-context-tree--/2026-04-23T20-37-29-103Z_019dbc0f-db8e-74c9-94ed-7ae9ca5ed07f.jsonl