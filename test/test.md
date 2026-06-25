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