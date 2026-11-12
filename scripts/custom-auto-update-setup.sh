#!/usr/bin/env bash
# Installs the launchd job that keeps "/Applications/Pokebots.app" on the newest `origin/main`.
#
#   scripts/custom-auto-update-setup.sh             install or update the job (runs every 5 minutes)
#   scripts/custom-auto-update-setup.sh --run-now   install it and start one run now
#   scripts/custom-auto-update-setup.sh --status    show the job, the last status and the log tail
#   scripts/custom-auto-update-setup.sh --remove    remove the job
#
# The job runs `scripts/custom-auto-update.sh` (see that file for what one run does). Run this from
# any checkout of the repository: the job uses the main checkout (the first worktree) for git.
set -euo pipefail

label="app.openbot.custom.autoupdate"
state="$HOME/.local/state/openbot-custom-autoupdate"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
here="$(cd "$(dirname "$0")/.." && pwd)"
source_repo="$(git -C "$here" worktree list --porcelain | sed -n '1s/^worktree //p')"

case "${1:-}" in
  --status)
    launchctl print "$domain/$label" 2>/dev/null | grep -E '^\s*(state|last exit code|run interval)' ||
      echo "The job is not installed."
    echo "Installed commit: $(cat "$state/installed-commit" 2>/dev/null || echo none)"
    cat "$state/status.json" 2>/dev/null || true
    tail -n 15 "$state/update.log" 2>/dev/null || true
    exit 0
    ;;
  --remove)
    launchctl bootout "$domain/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "Removed the job. The state stays in $state."
    exit 0
    ;;
  "" | --run-now) ;;
  *)
    echo "Unknown option: $1" >&2
    exit 2
    ;;
esac

mkdir -p "$state/bin" "$(dirname "$plist")"
cp "$here/scripts/custom-auto-update.sh" "$state/bin/custom-auto-update.sh.new"
chmod +x "$state/bin/custom-auto-update.sh.new"
mv "$state/bin/custom-auto-update.sh.new" "$state/bin/custom-auto-update.sh"

cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$state/bin/custom-auto-update.sh</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENBOT_CUSTOM_REPO</key><string>$source_repo</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><false/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$state/launchd.log</string>
  <key>StandardErrorPath</key><string>$state/launchd.log</string>
</dict>
</plist>
EOF
plutil -lint "$plist" >/dev/null

launchctl bootout "$domain/$label" 2>/dev/null || true
launchctl bootstrap "$domain" "$plist"
echo "Installed the job $label. It checks origin/main every 5 minutes."
echo "Git checkout: $source_repo"
echo "Log: $state/update.log"

if [[ "${1:-}" == "--run-now" ]]; then
  launchctl kickstart "$domain/$label"
  echo "Started one run now."
fi
