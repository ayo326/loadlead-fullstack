#!/usr/bin/env python3
"""
Post a deployment record to Jira after a successful deploy.

Reads the commit range since the last deploy tag (deploy/<env>/last) and:
  1. Creates a single Jira Task with label "deployment" summarising the deploy.
  2. Adds a single aggregated comment to each referenced SCRUM-<n> issue
     (one comment per ISSUE, not one per fanout). The comment text is the
     same across all referenced issues.
  3. Tags the deployed commit so the next deploy's range starts here.

Best-effort: if the Jira POST fails, this script logs and EXITS 0 so the
deploy itself doesn't fail — UNLESS this is a production deploy without a
DEPLOY_MSG, in which case it refuses to run at all (the shell script should
also gate on DEPLOY_MSG before invoking).

Auth: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (env only — never in repo).
Project: JIRA_PROJECT_KEY (default SCRUM).

Usage:
  python3 jira/post-deploy.py --env staging --sha $(git rev-parse HEAD) \\
                              --message "OO dashboard endpoint live"
"""

from __future__ import annotations
import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import List, Optional, Set

try:
    import requests
except ImportError:
    print("error: requests not installed. pip3 install --user requests", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY", "SCRUM")
SCRUM_RE = re.compile(r"SCRUM-(\d+)")


def run(cmd: List[str], check: bool = True) -> str:
    r = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, check=check)
    return r.stdout.strip()


def last_deploy_tag(env: str) -> Optional[str]:
    """The most recent deploy tag for this env, or None if never deployed."""
    tag = f"deploy/{env}/last"
    rc = subprocess.run(["git", "rev-parse", "-q", "--verify", tag], cwd=REPO_ROOT,
                        capture_output=True, text=True).returncode
    return tag if rc == 0 else None


def commit_range_log(prev: Optional[str], head: str) -> str:
    """git log <prev>..<head> --oneline. If no prev tag, show the last 50 commits."""
    if prev:
        return run(["git", "log", f"{prev}..{head}", "--oneline"], check=False)
    return run(["git", "log", "-n", "50", head, "--oneline"], check=False)


def parse_scrum_keys(text: str) -> List[str]:
    """Unique SCRUM-<n> keys in commit log order."""
    seen: Set[str] = set()
    out: List[str] = []
    for m in SCRUM_RE.finditer(text):
        k = f"SCRUM-{m.group(1)}"
        if k not in seen:
            seen.add(k)
            out.append(k)
    return out


def jira_request(method: str, path: str, body=None) -> requests.Response:
    base = os.environ["JIRA_BASE_URL"].rstrip("/")
    email = os.environ["JIRA_EMAIL"]
    token = os.environ["JIRA_API_TOKEN"]
    import base64
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    headers = {
        "Authorization": f"Basic {auth}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    url = f"{base}/{path.lstrip('/')}"
    for attempt in range(3):
        r = requests.request(method, url, headers=headers, json=body, timeout=30)
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", 2 ** attempt)))
            continue
        return r
    return r


def to_adf(text: str) -> dict:
    paragraphs = [
        {"type": "paragraph", "content": [{"type": "text", "text": line}]}
        for line in text.splitlines() if line.strip()
    ]
    return {"version": 1, "type": "doc", "content": paragraphs or [
        {"type": "paragraph", "content": [{"type": "text", "text": " "}]}
    ]}


def discover_issuetype_id(typename: str = "Task") -> Optional[str]:
    r = jira_request("GET", f"/rest/api/3/issue/createmeta?projectKeys={PROJECT_KEY}&expand=projects.issuetypes.fields")
    if not r.ok:
        return None
    for p in r.json().get("projects", []):
        for it in p.get("issuetypes", []):
            if it["name"].lower() == typename.lower():
                return it["id"]
    return None


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--env", required=True, help="dev | staging | prod")
    p.add_argument("--sha", required=True, help="deployed commit sha")
    p.add_argument("--message", default="", help="DEPLOY_MSG — required for prod")
    p.add_argument("--dry-run", action="store_true", help="print what would happen, don't call Jira")
    args = p.parse_args()

    env = args.env.lower()
    short_sha = args.sha[:7]

    # Production gate (defense-in-depth — the shell scripts also enforce this)
    if env == "prod" and not args.message.strip():
        print("error: DEPLOY_MSG required for prod deploys", file=sys.stderr)
        return 1

    # Required env (the script can still print the plan without these — useful for testing)
    missing = [v for v in ("JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN") if not os.environ.get(v)]
    if missing and not args.dry_run:
        print(f"warning: missing env {missing} — printing plan only (not posting).", file=sys.stderr)
        args.dry_run = True

    # ── Gather the commit range ─────────────────────────────────────────────
    prev_tag = last_deploy_tag(env)
    log = commit_range_log(prev_tag, args.sha)
    if not log.strip():
        log = "(no commits since last deploy)"
    keys = parse_scrum_keys(log)
    n_commits = len([l for l in log.splitlines() if l.strip()])

    # ── Build the deployment-record summary ────────────────────────────────
    today = time.strftime("%Y-%m-%d")
    summary = f"Deploy {env} {short_sha} {today}"
    description_text = "\n".join([
        f"Environment: {env}",
        f"Commit: {args.sha}",
        f"Previous tag: {prev_tag or '(none — first tracked deploy)'}",
        f"Commits in range: {n_commits}",
        f"SCRUM keys referenced: {', '.join(keys) if keys else '(none)'}",
        "",
        "DEPLOY_MSG:",
        args.message or "(not provided)",
        "",
        "Commit range (truncated):",
        log if len(log) < 4000 else log[:4000] + "\n…",
    ])
    comment_text = f"Deployed to {env} @ {short_sha} — {args.message or 'no DEPLOY_MSG'}"

    print(f"=== Jira deploy record ({env}) ===")
    print(f"  summary: {summary}")
    print(f"  links:   {', '.join(keys) if keys else '(none)'}")
    print(f"  aggregated comment: {comment_text}")

    if args.dry_run:
        print("\nDRY-RUN — not posting.")
        return 0

    # ── Create the deployment Task ──────────────────────────────────────────
    typeid = discover_issuetype_id("Task")
    if not typeid:
        print("warning: couldn't discover Task issuetype id — skipping create.", file=sys.stderr)
        return 0

    payload = {
        "fields": {
            "project": {"key": PROJECT_KEY},
            "summary": summary,
            "description": to_adf(description_text),
            "issuetype": {"id": typeid},
            "labels": ["deployment", f"env-{env}"],
        }
    }
    r = jira_request("POST", "/rest/api/3/issue", payload)
    if not r.ok:
        print(f"warning: Jira deploy issue POST failed {r.status_code}: {r.text[:300]}", file=sys.stderr)
        # Best-effort: don't fail the deploy.
        return 0
    deploy_key = r.json().get("key")
    print(f"  created Jira deploy issue: {deploy_key}")

    # ── Link every referenced SCRUM key as "Relates" + ONE aggregated comment ─
    for k in keys:
        try:
            jira_request("POST", "/rest/api/3/issueLink", {
                "type": {"name": "Relates"},
                "inwardIssue":  {"key": k},
                "outwardIssue": {"key": deploy_key},
            })
        except Exception as ex:
            print(f"  warn: link {k}↔{deploy_key} failed: {ex}", file=sys.stderr)

        try:
            jira_request("POST", f"/rest/api/3/issue/{k}/comment", {
                "body": to_adf(comment_text),
            })
        except Exception as ex:
            print(f"  warn: comment on {k} failed: {ex}", file=sys.stderr)

    # ── Tag the deployed commit so next deploy's range is correct ──────────
    tag = f"deploy/{env}/last"
    run(["git", "tag", "-f", tag, args.sha], check=False)
    # Best-effort push of the tag; if no remote configured, that's fine.
    run(["git", "push", "-f", "origin", tag], check=False)
    print(f"  tagged {args.sha[:7]} as {tag}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
