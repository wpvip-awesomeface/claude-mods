#!/usr/bin/env python3
import json, sys, os, re, hashlib, tempfile
d = json.load(sys.stdin)
ti = d.get("tool_input", {})
p = ti.get("file_path", "")
if ti.get("offset") or ti.get("limit") or not os.path.isfile(p):
    sys.exit(0)
try:
    lines = open(p, errors="ignore").read().splitlines()
except OSError:
    sys.exit(0)
if len(lines) <= 400:
    sys.exit(0)
key = hashlib.sha1((d.get("session_id", "") + p).encode()).hexdigest()
mark = os.path.join(tempfile.gettempdir(), "read-guard-" + key)
if os.path.exists(mark):
    sys.exit(0)  # second unchanged read is allowed
open(mark, "w").close()
pat = re.compile(r"\s*(def |class |function |export |async |#{1,3} |const \w+ = )")
outline = [f"{i+1}: {l.strip()[:100]}" for i, l in enumerate(lines) if pat.match(l)]
print(f"{p} has {len(lines)} lines. Outline:\n" + "\n".join(outline[:150])
      + "\nRe-read with offset/limit, or read again unchanged if you need it all.",
      file=sys.stderr)
sys.exit(2)
