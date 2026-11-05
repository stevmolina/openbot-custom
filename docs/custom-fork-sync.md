# OpenBot Custom: upstream sync

OpenBot Custom (`stevmolina/openbot-custom`) is a fork of `nightly-labs/openbot`. Each sync is a real
merge commit, so the next sync starts from the last merged upstream commit.

## Steps

1. `git remote add upstream https://github.com/nightly-labs/openbot.git` (once per checkout), then
   `git fetch upstream --tags`.
2. Make a worktree from `origin/main`, and set `git config rerere.enabled true` in it.
3. `git merge-tree --write-tree --name-only origin/main upstream/main` lists the conflicts before
   the merge.
4. `git merge --no-ff upstream/main`. Where upstream now has the same feature, take upstream's
   version and drop ours.
5. Check `src/backend` migrations. The fork adds none: remote coding jobs keep their state in JSON
   files under the agent workspace (`.openbot/coding-jobs/`).

## Fork-owned files

Keep fork code in these files, and keep the hook in each upstream file to one call or one prop.

| Feature | Fork file | Hook in the upstream file |
| --- | --- | --- |
| Thread worker rows, HTML visual replies, reactions, read aloud | `src/renderer/src/features/conversation/custom-thread-extras.tsx` | `useCustomThreadExtras` in `ConversationThread.tsx` and `ConversationSideThread.tsx` |
| Sidebar thread lanes | `src/renderer/src/features/sidebar/custom-sidebar-thread-lanes.ts` | `useCustomSidebarThreadLanes` and `threadLanes` in `WorkspaceSidebar.tsx` |
| Remote coding jobs | `src/backend/agent-tasks/coding-*.ts`, `remote-coding-task.ts` | `codingJobs` in `agent-tasks.ts` and `agent-service.ts` |
| Per-agent screens | `src/backend/agent/agent-screens.ts`, `scripts/hosting/openbot-agent-screen` | `DISPLAY` in `claude-client.ts`, reaper in `application-services.ts` |
| Ad hoc signed build | `electron-builder.custom.yml`, `build/custom/` | none |

Do not add fields to released Team API routes (`agent-tasks-v1`, `agent-thread-files-v1`). Use a new
optional capability, as upstream did with `agent-thread-replies-v1`.
