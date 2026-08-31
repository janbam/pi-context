```bash
pi --no-skills --no-extensions --skill ./skills -e ./src/index.ts -e ./src/context.ts
```

```md
Context Tool Test Task
Strictly follow the steps below.
1. Create a checkpoint for the starting point from here.
2. Generate a random number, write it to the file /tmp/pi-context-random, and display it using cat.
3. Compact to the start. The compact summary must not include the value of the random number but must state what the next step is.
4. Find a way to guess the value of the random number without reading the file.
5. Read the file to compare and see if the guess was correct.
6. Output "Success" if the guess is correct; otherwise, output "Failure".
```

## Compaction advancement regression

Launch Pi with the passive-entry fixture:

```bash
pi --no-skills --no-extensions -e ./src/index.ts -e ./src/context.ts -e ./test/passive-custom-extension.ts
```

1. Enable ACM with `/acm` and ask the agent to checkpoint, inspect the timeline, and call `context_compact`.
2. Confirm that label, session-info, and non-contextual custom entries appended while `waitForIdle()` settles do not cancel compaction.
3. Repeat while submitting a real user steering message before compaction settles; confirm that any message entry cancels compaction exactly once and creates no summary branch.
4. Confirm that the next model request contains no orphaned tool result.

## ACM session-state regression

1. Start a new named session with `auto_enable = true`; confirm ACM is enabled without typing `/acm` and the session JSONL contains a `type: "session"` record with a nested `sessionState` field outside the conversation tree.
2. Run `/acm disable`, exit, and resume with `pi -c`; confirm ACM stays disabled even though auto-enable remains configured.
3. Run `/acm enable`, exit, and resume again; confirm ACM is enabled and `context_compact` has a fresh navigation-capable command context.
4. Change ACM state several times before sending a prompt; confirm only the first model call receives one `<system-notification>` immediately before the real user message and that it contains only the final state. Confirm later model calls and redundant `/acm enable` or `/acm disable` commands receive no notification.
5. Create a new session with `/new`; confirm the configured auto-enable value initializes that new session independently.
