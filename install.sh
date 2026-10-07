#!/usr/bin/env bash
# Set up these mods on a new machine.
# Usage: git clone <this repo> ~/.claude/mods && ~/.claude/mods/install.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$HERE" != "$HOME/.claude/mods" ]; then
  echo "Clone this repo to ~/.claude/mods first (it lives at $HERE)." >&2
  exit 1
fi

# The `mods` command, on your PATH.
chmod +x "$HERE/mods"
mkdir -p "$HOME/.local/bin"
ln -sf "$HERE/mods" "$HOME/.local/bin/mods"

# Start a personal quote list for workbench, if there isn't one.
Q="$HERE/workbench/assets"
[ -f "$Q/quotes.txt" ] || cp "$Q/quotes.example.txt" "$Q/quotes.txt"

# Load every mod in new sessions, and hot-reload them when files change.
[ -f "$HOME/.claude/settings.json" ] || echo '{}' > "$HOME/.claude/settings.json"
"$HERE/mods" on all
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.claude/settings.json')
s = json.load(open(p))
s.setdefault('env', {})['CLAUDE_CODE_PLUGIN_DIR_WATCH'] = '1'
json.dump(s, open(p, 'w'), indent=2); open(p, 'a').write('\n')
PY

echo "Done. Start a new Claude Code session to see the mods."
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo "Add ~/.local/bin to your PATH to use the 'mods' command.";; esac
