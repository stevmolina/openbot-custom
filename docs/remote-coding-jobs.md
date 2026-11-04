# Remote coding jobs (custom app)

`openbot.run_coding_task` accepts `repository` (`owner/repo`), `title`, and `task`.
It starts an existing OpenBot task lane with a persisted Agent Computer brief.
The task uses connected computer tools and Codex. No local credentials are sent.
The task's existing tab shows progress, questions, and its result. Send a message
in that same task to continue after sign-in or a machine pause.

The context is deterministic per tool call. Retrying the call returns the same
OpenBot task through the existing task idempotency key. Existing queue limits,
boot recovery, conversation storage and provider handoffs apply.

This is agent orchestration, not a remote process supervisor. Machine lifecycle,
checkpoints and CLI execution are instructions carried out by the task agent.
The task Stop button interrupts the agent turn. It cannot guarantee that a remote
background process stops. Ask the task to stop its remote job and verify the PID
before stopping the orchestration. A future direct lifecycle adapter is needed
for automatic cancellation and guaranteed deadline checkpointing.

Codex and GitHub must be signed in on Agent Computer. Missing sign-in blocks live
execution, not creating the task. No API key or GitHub token is copied from the
host. PR creation remains subject to user review. The result includes a diff,
focused check commands and their exit codes, and a local PR draft.

## Verification

Run `bun scripts/remote-coding-task-smoke.ts` to check the public tool catalog,
input rejection, brief persistence contract and real tool dispatch into a task.
This does not prove remote Codex execution. For that check, invoke the tool in an
isolated app profile with an authenticated computer connection. Confirm the task
appears, follow its live view, complete sign-in, inspect its diff and checks, ask
it to stop, and confirm the remote process stopped and the machine paused.

Custom source base: `1492f1313` (side-thread tasks), descended from
`stevmolina/openbot-fixes` main `882858fae`. This change must not be deployed as
an upstream `stevmolina/openbot` build.
