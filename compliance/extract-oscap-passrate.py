#!/usr/bin/env python3
"""
Extract OpenSCAP pass-rate from an ARF XML report.

Counts rule-result elements where the <result> value is "pass" (or "fixed")
vs "fail", and writes {host_pass_rate, opened_ll_ids} as JSON to stdout.

Kept as a standalone script (not embedded in YAML) so its indentation isn't
mangled by docker run -c 'bash -c ...' double-quoting.
"""
import json
import os
import re
import sys

src = sys.argv[1] if len(sys.argv) > 1 else "/out/oscap.arf.xml"

if not os.path.exists(src):
    print(json.dumps({"host_pass_rate": None, "opened_ll_ids": []}))
    sys.exit(0)

with open(src, "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

# rule-result/<result> form first, then attribute form for older ARF.
results = re.findall(r"<result>([^<]+)</result>", text)
if not results:
    results = re.findall(r"rule-result[^>]+result=\"([^\"]+)\"", text)

passes = sum(1 for r in results if r.strip() in ("pass", "fixed"))
fails = sum(1 for r in results if r.strip() in ("fail",))
total = passes + fails
rate = (passes / total) if total else None

print(json.dumps({"host_pass_rate": rate, "opened_ll_ids": []}))
