#!/usr/bin/env bash
# Keeps "/Applications/Pokebots.app" on the newest commit of `origin/main`.
#
# A launchd job runs this script every 5 minutes (`scripts/custom-auto-update-setup.sh` installs the
# job). The job does not belong to an agent session, so it cannot stop when a session ends.
#
# One run:
#   1. Fetch `origin/main`. Stop when the installed commit is already the newest, or when the new
#      commits change only files that are not in the app (docs, mobile, account service, CI).
#   2. Build the newest commit in its own worktree with `scripts/custom-build-install.sh --no-install`.
#      When `main` moved during the build, build the newest commit again (3 builds at most).
#   3. Wait until no local agent works, for 10 minutes at most.
#   4. Quit the app, copy it to `~/OpenBot/backups/` (the 3 newest copies stay), install the new app,
#      and open it. When the new app does not stay up, put the copy back.
#   5. Write `status.json` and show a macOS notification.
#
# State, the build worktree and the log are in ~/.local/state/openbot-custom-autoupdate/.
# A failed build is not tried again until `main` moves. `--force` builds and installs the newest
# commit even when it is installed already.
set -euo pipefail

main() {
  local force=0
  [[ "${1:-}" == "--force" ]] && force=1

  state="$HOME/.local/state/openbot-custom-autoupdate"
  source_repo="${OPENBOT_CUSTOM_REPO:?Set OPENBOT_CUSTOM_REPO to the openbot-custom checkout.}"
  worktree="$state/repo"
  log="$state/update.log"
  target="/Applications/Pokebots.app"
  legacy_target="/Applications/OpenBot Custom.app"
  app_process="^/Applications/(Pokebots|OpenBot Custom)\\.app/Contents/MacOS/(Pokebots|OpenBot)"
  mkdir -p "$state"
  # Keep the log small: the last 2000 lines.
  if [[ -f "$log" ]] && (($(wc -l <"$log") > 4000)); then
    tail -n 2000 "$log" >"$log.tmp" && mv "$log.tmp" "$log"
  fi
  exec >>"$log" 2>&1

  setup_path
  take_lock || exit 0
  say "Run started (pid $$)."

  fetch_main
  local newest installed failed
  newest="$(git -C "$source_repo" rev-parse origin/main)"
  installed="$(cat "$state/installed-commit" 2>/dev/null || true)"
  failed="$(cat "$state/failed-commit" 2>/dev/null || true)"

  if [[ "$force" == 0 ]]; then
    if [[ "$newest" == "$installed" ]]; then
      say "Up to date at $(short "$newest")."
      return 0
    fi
    if [[ "$newest" == "$failed" ]]; then
      say "$(short "$newest") failed before. Waiting for a new commit."
      return 0
    fi
    if [[ -n "$installed" ]] && ! app_changed "$installed" "$newest"; then
      say "$(short "$installed")..$(short "$newest") changes no app file. Recording it as installed."
      echo "$newest" >"$state/installed-commit"
      return 0
    fi
  fi

  local built=""
  for _ in 1 2 3; do
    write_status building "$newest" "Building $(describe "$newest")."
    if ! build "$newest"; then
      echo "$newest" >"$state/failed-commit"
      write_status build_failed "$newest" "The build of $(describe "$newest") failed. See $log."
      notify "Build failed for $(describe "$newest"). The installed app did not change."
      return 1
    fi
    built="$newest"
    fetch_main
    newest="$(git -C "$source_repo" rev-parse origin/main)"
    [[ "$newest" == "$built" ]] && break
    app_changed "$built" "$newest" || break
    say "main moved to $(short "$newest") during the build. Building the newest commit."
  done

  wait_for_idle_agents
  install_app "$built"
  refresh_own_copy
}

setup_path() {
  local brew prefix
  for brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$brew" ]]; then
      prefix="$("$brew" --prefix)"
      export PATH="$prefix/opt/node@24/bin:$prefix/bin:$PATH"
      break
    fi
  done
  export PATH="$HOME/.local/bin:$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
}

say() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }
short() { git -C "$source_repo" rev-parse --short "$1"; }

# "PR #70: Make the dock rows taller" for a merge commit, else the commit subject.
describe() {
  local subject body
  subject="$(git -C "$source_repo" log -1 --format=%s "$1")"
  body="$(git -C "$source_repo" log -1 --format=%b "$1" | sed -n '/./{p;q;}')"
  if [[ "$subject" =~ ^Merge\ pull\ request\ (#[0-9]+) && -n "$body" ]]; then
    echo "PR ${BASH_REMATCH[1]}: $body"
  else
    echo "$(short "$1") $subject"
  fi
}

# A directory lock. A lock whose process is gone is taken over.
take_lock() {
  local lock="$state/lock"
  if mkdir "$lock" 2>/dev/null; then
    echo $$ >"$lock/pid"
  else
    local owner
    owner="$(cat "$lock/pid" 2>/dev/null || true)"
    if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
      return 1
    fi
    echo $$ >"$lock/pid"
  fi
  trap 'rm -rf "$state/lock"' EXIT
}

# HTTPS with the GitHub CLI token, so the job does not need an SSH agent.
fetch_main() {
  git -C "$source_repo" -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
    fetch -q https://github.com/stevmolina/openbot-custom.git '+refs/heads/main:refs/remotes/origin/main'
}

# True when a file in the range can change the desktop app.
app_changed() {
  local count
  count="$(git -C "$source_repo" diff --name-only "$1" "$2" |
    grep -cvE '^(docs/|changelog\.d/|apps/mobile/|apps/auth-api/|apps/site-router/|remote/|\.github/|[^/]*\.md$)' || true)"
  ((count > 0))
}

build() {
  local commit="$1"
  if [[ ! -d "$worktree/.git" && ! -f "$worktree/.git" ]]; then
    git -C "$source_repo" worktree add -q --detach "$worktree" "$commit"
  fi
  git -C "$worktree" checkout -q --detach -f "$commit"
  git -C "$worktree" clean -fdq
  say "Building $(describe "$commit")."
  (cd "$worktree" && GH_TOKEN="$(gh auth token)" bash scripts/custom-build-install.sh --no-install)
}

# The total CPU of the app's own child processes (agent runtimes and their tools), without the
# Electron helpers. Idle runtimes use a few percent; an agent at work uses much more.
agents_cpu() {
  local main_pid
  main_pid="$(pgrep -f "$app_process" | head -n 1 || true)"
  [[ -n "$main_pid" ]] || { echo 0; return; }
  ps -axo pid=,ppid=,%cpu=,comm= | awk -v root="$main_pid" '
    { pid[NR] = $1; parent[NR] = $2; cpu[NR] = $3; name[NR] = $0 }
    END {
      inside[root] = 1
      do {
        grown = 0
        for (i = 1; i <= NR; i++) if (inside[parent[i]] && !inside[pid[i]]) { inside[pid[i]] = 1; grown = 1 }
      } while (grown)
      for (i = 1; i <= NR; i++)
        if (inside[pid[i]] && pid[i] != root && name[i] !~ /Helper|crashpad|cua-driver/) total += cpu[i]
      printf "%d\n", total
    }'
}

wait_for_idle_agents() {
  local waited=0 first second
  while ((waited < 600)); do
    first="$(agents_cpu)"
    sleep 10
    second="$(agents_cpu)"
    if ((first < 25 && second < 25)); then
      return 0
    fi
    ((waited == 0)) && say "An agent is working (CPU $first%, $second%). Waiting up to 10 minutes."
    write_status waiting "" "Waiting for local agents to finish."
    sleep 20
    waited=$((waited + 30))
  done
  say "Agents still work after 10 minutes. Installing now."
}

quit_app() {
  pgrep -f "$app_process" >/dev/null || return 0
  say "Quitting Pokebots."
  osascript -e 'tell application id "app.openbot.custom" to quit' >/dev/null 2>&1 || true

  for _ in $(seq 60); do pgrep -f "$app_process" >/dev/null || return 0; sleep 1; done
  say "The app did not quit in 60 seconds. Stopping it."
  pkill -TERM -f "$app_process" || true
  for _ in $(seq 20); do pgrep -f "$app_process" >/dev/null || return 0; sleep 1; done
  pkill -KILL -f "$app_process" || true
  sleep 2
}

install_app() {
  local commit="$1" built backup restore_target
  built="$(find "$worktree/dist-custom" -maxdepth 2 -name '*.app' -type d | head -n 1)"
  [[ -n "$built" ]] || { say "No built app in $worktree/dist-custom."; return 1; }

  write_status installing "$commit" "Installing $(describe "$commit")."
  quit_app
  mkdir -p "$HOME/OpenBot/backups"
  backup=""
  restore_target="$target"
  if [[ -d "$legacy_target" ]]; then
    backup="$HOME/OpenBot/backups/OpenBot-Custom-before-$(short "$commit")-$(date -u +%Y%m%dT%H%M%SZ).app"
    restore_target="$legacy_target"
    ditto "$legacy_target" "$backup"
    rm -rf "$legacy_target"
  fi
  if [[ -d "$target" ]]; then
    backup="$HOME/OpenBot/backups/Pokebots-before-$(short "$commit")-$(date -u +%Y%m%dT%H%M%SZ).app"
    restore_target="$target"
    ditto "$target" "$backup"
    rm -rf "$target"
  fi
  ditto "$built" "$target"
  open -a "$target"
  sleep 20

  if pgrep -f "$app_process" >/dev/null; then
    echo "$commit" >"$state/installed-commit"
    rm -f "$state/failed-commit"
    say "Installed $(describe "$commit")."
    write_status installed "$commit" "Installed $(describe "$commit")."
    notify "Updated to $(describe "$commit")."
    prune_backups
  else
    say "The new app did not stay up. Restoring the previous app."
    echo "$commit" >"$state/failed-commit"
    rm -rf "$target"
    if [[ -n "$backup" ]]; then
      ditto "$backup" "$restore_target"
      open -a "$restore_target"
    fi
    write_status launch_failed "$commit" "$(describe "$commit") did not start. The previous app is back."
    notify "$(describe "$commit") did not start. The previous app is back."
    return 1
  fi
}

prune_backups() {
  # The names end in a UTC time stamp, so the newest sort last.
  find "$HOME/OpenBot/backups" -maxdepth 1 \( -name 'Pokebots-before-*.app' -o -name 'OpenBot-Custom-before-*.app' \) -type d |
    awk -F- '{ print $NF "\t" $0 }' | sort | cut -f2- |
    awk '{ line[NR] = $0 } END { for (i = 1; i <= NR - 3; i++) print line[i] }' |
    while IFS= read -r old; do rm -rf "$old"; done
}

# The job runs a copy of this script, so a checkout cannot change it during a run.
refresh_own_copy() {
  local copy="$state/bin/custom-auto-update.sh" fresh="$worktree/scripts/custom-auto-update.sh"
  [[ -f "$fresh" ]] || return 0
  cmp -s "$fresh" "$copy" && return 0
  mkdir -p "$state/bin"
  cp "$fresh" "$copy.new" && chmod +x "$copy.new" && mv "$copy.new" "$copy"
  say "Updated the job script from main."
}

write_status() {
  local status="$1" commit="$2" message="$3"
  printf '{"status":"%s","commit":"%s","message":"%s","at":"%s"}\n' \
    "$status" "$commit" "${message//\"/\'}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$state/status.json"
}

notify() {
  local text="${1//\"/\'}"
  osascript -e "display notification \"$text\" with title \"Pokebots\"" >/dev/null 2>&1 || true
}

main "$@"
exit
