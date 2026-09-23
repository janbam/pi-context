# Pi Context: Agentic Context Management for Pi

An Agentic Context Management tool that helps AI agents keep long conversations focused by maintaining a clean working set: checkpoint useful anchors, inspect the active history structure, and compact noisy completed paths into state summaries.

Inspired by kimi-cli d-mail, it brings lossless time travel to Pi's session tree.

For more on the design philosophy, see the [blog post](https://blog.xlab.app/p/51d26495/) ([中文版本](https://blog.xlab.app/p/6a966aeb/)).

## Naming migration note

Earlier versions used more Git-like names such as `context_tag`, `context_log`, and `context_checkout`.

Current versions intentionally use conversation-native names instead:
- `context_checkpoint`
- `context_timeline`
- `context_compact`

These tools manage **conversation history**, not repository state. They should not be treated as Git commands or as replacements for real `git tag`, `git log`, or `git checkout`. Context navigation does not modify or roll back files, running processes, browser state, tickets, databases, or remote services.

## Installation

This development version targets the forked Pi APIs in Jan's sibling `pi-mono` checkout and is intentionally not publishable to npm yet. Use this repository layout:

```text
~/src/pi-mono/
~/src/pi-extensions/pi-context/
```

`pnpm-workspace.yaml` links `@earendil-works/pi-coding-agent` to `../../pi-mono/packages/coding-agent`. Install and run the extension locally:

```bash
pnpm install
pi -e ./src/index.ts -e ./src/context.ts --skill ./skills
```

Remove the package's private marker and restore npm installation instructions only after the required session-state APIs are available in a published Pi version and `peerDependencies` declares that minimum compatible version.

## Usage

### For Humans

Control ACM (**A**gentic **C**ontext **M**anagement) for the current session:

```text
/acm          # Toggle
/acm enable   # Enable explicitly
/acm disable  # Disable explicitly
```

The effective state is stored outside the conversation tree and survives exit, `pi -c`, `/resume`, `/reload`, and tree navigation. Commands do not become conversation messages. When a command changes the effective state, the next agent turn receives one ephemeral system notification immediately before the real user message. The notification is consumed by that first model call; redundant commands and later calls emit nothing. Repeated state changes before the next turn collapse into one notification containing only the final state.

Before compacting, the extension acquires the command context it needs for tree navigation automatically; no manual command is required after startup, resume, or `/reload`.

### Checkpoint naming and timeline estimates

Use checkpoint names ending in `-start`, `-done`, `-pivot`, `-pause`, or `-resume` to declare a task or phase change, keeping the scope prefix consistent within a phase's lifecycle (for example `parser-investigation-start` → `parser-investigation-done`). Other names remain valid ordinary anchors. Timeline displays the parsed phase next to each label, folds hidden intervals with message counts and approximate tokens using Pi's heuristic, and marks off-path summaries. Interval estimates describe historical content, exclude internal context-management traffic, and are not exact current-model occupancy or reclaimable space.

### Context dashboard

Open a visual dashboard to inspect context-window usage and token distribution (similar to `claude code /context`).

```bash
/context
```

![](img/context.png)

### Configuration

Create `~/.pi/agent/pi-context.toml` to choose the initial state for new sessions:

```toml
auto_enable = true
```

The path follows `PI_CODING_AGENT_DIR` when that pi environment variable is set. The default is `false` when the file is absent. `auto_enable` initializes only new sessions; resumed, reloaded, and derived sessions keep their durable session state. Legacy resumed sessions without saved ACM state initialize as disabled.

### Session analysis (repository checkout)

Generate an offline token timeline from a saved Pi session, with checkpoint markers, compaction events, cumulative usage, and an explicitly simulated threshold-only comparison:

```bash
pnpm analyze:session /path/to/session.jsonl --out /path/to/report
```

Open `report/session-token-chart.html` in a browser. See [session analysis documentation](tools/session-analysis/README.md) for snapshot cutoffs, simulation parameters, measurement limits, and privacy notes. This developer tool is not included in the extension package.

### For Agents

This extension adds the `context-management` skill, which guides agents to keep the active conversation as the smallest sufficient working set for the next step. It includes three core tools:

1. **🔖 Anchor (`context_checkpoint`)**
   Label a meaningful conversation node with a unique semantic checkpoint name, such as `parser-investigation-start` and `parser-investigation-done`.

2. **📊 Inspect (`context_timeline`)**
   View the active path as a structural map of checkpoints, summaries/compactions, branch points, user turns, and current position. Use it when orientation or compact target selection depends on history shape.

3. **⏪ Compact (`context_compact`)**
   Create a summarized continuation branch from an earlier checkpoint, history node, or `root`. The summary should restore the useful state after the target: current task, decisions, external side effects such as changed files or remote updates, validation state, source anchors, and the explicit next step.
