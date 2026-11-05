#!/usr/bin/env bash
# Builds the OpenBot Custom app from the current checkout and installs it in /Applications.
# Run it from a clean checkout of `origin/main` after each merge, so the installed app matches main.
#
#   scripts/custom-build-install.sh            build, back up, install, launch check
#   scripts/custom-build-install.sh --no-install   build only
#
# The build follows `electron-builder.custom.yml`. It uses the Bun version in `package.json`
# (`packageManager`) and Node 24. When the Bun on PATH is another version, the script downloads the
# pinned one into `.openbot-build/bun-<version>` (git ignores it) and uses it for this run only.
# Before it replaces the installed app, it copies it to `~/OpenBot/backups/`. After the install it
# opens the app and checks that the process stays up, because macOS kills an ad hoc app with a bad
# signature at launch.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
install=1
[[ "${1:-}" == "--no-install" ]] && install=0

app_name="OpenBot Custom"
target="/Applications/${app_name}.app"
bun_version="$(sed -n 's/.*"packageManager": "bun@\([0-9.]*\)".*/\1/p' package.json)"

# Node 24 from Homebrew, when it is there.
if command -v brew >/dev/null 2>&1 && [[ -d "$(brew --prefix)/opt/node@24/bin" ]]; then
  export PATH="$(brew --prefix)/opt/node@24/bin:$PATH"
fi

# The pinned Bun.
if [[ "$(bun --version 2>/dev/null || true)" != "$bun_version" ]]; then
  bun_dir="$root/.openbot-build/bun-$bun_version"
  if [[ ! -x "$bun_dir/bin/bun" ]]; then
    echo "Installing Bun $bun_version in $bun_dir"
    mkdir -p "$bun_dir"
    installer="$(mktemp)"
    curl -fsSL https://bun.sh/install -o "$installer"
    # SHELL=/bin/false stops the installer from editing a shell profile.
    BUN_INSTALL="$bun_dir" SHELL=/bin/false bash "$installer" "bun-v$bun_version" >/dev/null
    rm -f "$installer"
  fi
  export PATH="$bun_dir/bin:$PATH"
fi
echo "Bun $(bun --version), Node $(node --version), commit $(git rev-parse --short HEAD)"

unset ELECTRON_RUN_AS_NODE
bun install --frozen-lockfile
bun run voice:prepare-runtime
if ! bun run prepare:remote-desktop-runtime; then
  # The installer's download can fail with HTTP 504 while `gh` still gets the same release files.
  echo "Retrying the remote desktop runtime with gh release download"
  release="$(bun -e 'const l = await Bun.file("native-runtime.lock.json").json(); const r = l.remoteDesktop.artifactRelease; console.log(`${r.repository} ${r.tag}`)')"
  assets="$root/.openbot-build/remote-desktop-release"
  rm -rf "$assets" && mkdir -p "$assets"
  gh release download "${release#* }" --repo "${release%% *}" --dir "$assets" \
    --pattern 'remote-desktop-runtime-manifest.json' --pattern 'remote-desktop-runtime-darwin-arm64.tar.gz'
  bun scripts/custom-install-remote-desktop-runtime.ts "$assets"
fi
bun run verify:remote-desktop-runtime
bun run prepare:cua-driver
bun run build
rm -rf dist-custom
bunx electron-builder --dir --mac --arm64 --config electron-builder.custom.yml

built="$(find dist-custom -maxdepth 2 -name '*.app' -type d | head -n 1)"
[[ -n "$built" ]] || { echo "No app in dist-custom." >&2; exit 1; }
echo "Built $built"
[[ "$install" == 1 ]] || exit 0

if pgrep -f "${target}/Contents/MacOS" >/dev/null; then
  echo "${app_name} is running. Quit it, then run this script again." >&2
  exit 1
fi

if [[ -d "$target" ]]; then
  mkdir -p "$HOME/OpenBot/backups"
  backup="$HOME/OpenBot/backups/OpenBot-Custom-before-$(git rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ).app"
  ditto "$target" "$backup"
  echo "Backed up the installed app to $backup"
  rm -rf "$target"
fi
ditto "$built" "$target"
echo "Installed $target"

# Launch check: the process must still run after 15 seconds.
open -a "$target"
sleep 15
if pgrep -f "${target}/Contents/MacOS" >/dev/null; then
  echo "Launch check passed: ${app_name} is running."
else
  echo "Launch check failed: ${app_name} quit. See /usr/bin/log show --last 2m --predicate 'process == \"amfid\"'." >&2
  exit 1
fi
