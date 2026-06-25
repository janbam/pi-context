# Context Management Natural Actionable Eval Notes

This set uses more realistic user wording but also provides enough concrete input that the agent can start working immediately.

## What this set tests

1. **Natural triggering with actionable input**
   - Does the skill trigger when the task shape is realistic rather than skill-aware, but the prompt contains enough concrete material to begin now?

2. **Natural reference routing with actionable input**
   - Does the agent read the right scenario reference once it has enough task material to act?

3. **Natural first structural action**
   - Does the agent take an actual first structural move such as `context_checkpoint`, instead of only promising it will do so later?

## Why this set exists

The original natural-language set mixed two cases together:
- realistic prompts
- but often not enough concrete input to begin real work

This actionable set isolates the case where realistic wording and immediate executability coexist.
