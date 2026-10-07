## Token discipline

- Cost is roughly turns x context size. Every turn re-reads the whole
  conversation, so turn count and subagent count are the real levers.
- Default to doing work inline. Only spawn a subagent when the work is
  genuinely parallel, needs to run in the background, or would flood the
  main thread with output that isn't needed afterward.
- Never spawn a subagent for a task that's a single read/grep/edit away.
- Batch related sub-tasks into one broader agent instead of several
  narrow ones. Each agent re-pays its own system-prompt overhead.
- Every subagent prompt must include a report-length cap, e.g.
  "report back in under 150 words".
- Prefer one long-running background agent over a polling loop.
- Push bulk/repetitive tool work into a script run once via Bash.
- Fresh session per chapter: when a chunk of work ends, write a 5-10 line
  handoff (goal, state, links, next step) and suggest a new session.
- Replies: action first, short bullets, no walls of text.
- Read guard: whole-file reads over 400 lines are blocked once and return
  an outline. Re-read with offset/limit.
