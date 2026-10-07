# Agent setup: stop burning tokens

Instructions for a coding agent (Claude Code or similar) to set up the token-saving
kit on the user's machine. Do each step, skip any step that is already done, and
report what you changed in under 100 words. Ask the user before step 4.

Repo: https://github.com/wpvip-awesomeface/claude-mods

## 1. Get the files

If `~/.claude/mods/.git` exists, run `git -C ~/.claude/mods pull`.
Otherwise, if `~/.claude/mods` does not exist, run
`git clone https://github.com/wpvip-awesomeface/claude-mods.git ~/.claude/mods`.
If `~/.claude/mods` exists but is not this repo, clone to
`~/.claude/token-kit-src` instead and use that path below (skip step 4).

## 2. Add the working rules

Append the contents of `token-kit/claude-md-snippet.md` to `~/.claude/CLAUDE.md`
(create the file if missing). Skip this if a `## Token discipline` heading is
already there. Do not change anything else in that file.

## 3. Install the read guard hook

Copy `token-kit/read_guard.py` to `~/.claude/hooks/read_guard.py`.
In `~/.claude/settings.json`, add this to `hooks.PreToolUse`, keeping every
existing hook and setting as is (merge the JSON, never overwrite the file):

```json
{ "matcher": "Read", "hooks": [ { "type": "command", "command": "python3 ~/.claude/hooks/read_guard.py" } ] }
```

Skip if a PreToolUse hook already runs `read_guard.py`.

## 4. Install the mods (ask first)

Ask the user: "Install the bento, turn-timer and recipe-card mods too?"
If yes, run `~/.claude/mods/install.sh`, then turn off the ones they don't want
with `~/.claude/mods/mods off <name>`. `workbench` is personal to the author's
setup, so turn it off unless the user asks for it.

## 5. Finish

Tell the user to start a new session so the rules, hook and mods load.
