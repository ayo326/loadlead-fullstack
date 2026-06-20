#!/usr/bin/env python3
"""
LoadLead — Jira Sync (idempotent, dry-run by default).

Reads jira/work-manifest.yaml + live status sources (test-results.json,
compliance-results.json), then plans/executes create/update/transition
operations against a Jira Cloud Scrum project (key SCRUM).

Idempotency:
- jira/sync-map.json maps ext_id → Jira key. Source of truth for "exists?".
- Each created issue is ALSO stamped with a `extid:<ext_id>` label as a
  recoverable backup — if sync-map.json is lost, we can rebuild it by
  searching `labels = "extid:<ext_id>"`.

Guardrails (hard):
- Default is dry-run. Issues are only created/modified with --apply.
- Sync MAY move issues between "To Do" and "Done" based on automated
  status. It MUST NOT override "In Progress" or "In Review" (those are
  human-owned states; we log and skip).
- Sync NEVER reads/writes credentials from files in the repo. Auth comes
  from env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.
- Sync NEVER puts secrets, tokens, or PII in Jira descriptions.

Usage:
  python3 jira/sync.py                      # dry-run (default)
  python3 jira/sync.py --apply              # actually create/update
  python3 jira/sync.py --apply --only test  # only items whose ext_id starts with `test:`
  python3 jira/sync.py --rebuild-map        # rebuild sync-map.json from Jira labels

Exit codes:
  0  plan/apply succeeded
  1  config error (missing env)
  2  Jira API call failed (rate-limited / 5xx after retries)
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    print("error: pyyaml not installed. Run: pip3 install --user pyyaml requests", file=sys.stderr)
    sys.exit(1)

try:
    import requests
except ImportError:
    print("error: requests not installed. Run: pip3 install --user pyyaml requests", file=sys.stderr)
    sys.exit(1)

# ── Config ──────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "jira" / "work-manifest.yaml"
SYNC_MAP = REPO_ROOT / "jira" / "sync-map.json"
PROJECT_KEY = os.environ.get("JIRA_PROJECT_KEY", "SCRUM")

# Status-source data
TEST_RESULTS = REPO_ROOT / "test-results.json"
COMPLIANCE_RESULTS = REPO_ROOT / "compliance-results.json"

# Human-owned states the sync MUST NOT clobber (spec rule).
HUMAN_OWNED_STATES = {"In Progress", "In Review"}

# Sync-driven target states.
TARGET_TODO = "To Do"
TARGET_DONE = "Done"


@dataclass
class JiraIssueSpec:
    """The desired state of one Jira issue, derived from the manifest + live data."""
    ext_id: str
    title: str
    description: str
    type: str                   # Epic | Story | Task | Sub-task
    parent_ext_id: Optional[str] = None
    labels: List[str] = field(default_factory=list)
    links: List[str] = field(default_factory=list)
    target_status: str = TARGET_TODO

    @property
    def summary(self) -> str:
        # "<ext_id> — <title>" so Jira's quick-search by id works.
        return f"{self.ext_id} — {self.title}"

    @property
    def all_labels(self) -> List[str]:
        # `extid:<ext_id>` is the recoverable backup for sync-map.json.
        # Jira labels can't contain spaces, so spaces are normalised to -.
        norm = lambda s: s.replace(" ", "-").replace(":", "-").lower()
        return sorted({f"extid-{norm(self.ext_id)}"} | {norm(l) for l in self.labels})


# ── Manifest + live status ──────────────────────────────────────────────────

def load_manifest() -> Tuple[List[dict], List[dict]]:
    """Returns (epics, items). Items are everything below epics."""
    with MANIFEST.open() as f:
        m = yaml.safe_load(f)
    return m.get("epics", []), m.get("items", [])


def load_live_statuses() -> Tuple[Dict[str, str], Dict[str, str]]:
    """Read the two automated status sources. Missing files → empty dict."""
    tests = {}
    compliance = {}
    if TEST_RESULTS.exists():
        with TEST_RESULTS.open() as f:
            data = json.load(f)
        for k, v in data.items():
            if k.startswith("__"):
                continue
            tests[k] = v   # 'pass' | 'fail' | 'blocked' | etc.
    if COMPLIANCE_RESULTS.exists():
        with COMPLIANCE_RESULTS.open() as f:
            data = json.load(f)
        for k, v in data.items():
            if k.startswith("__"):
                continue
            compliance[k] = v  # 'Open' | 'NotAFinding'
    return tests, compliance


def resolve_status(item: dict, tests: Dict[str, str], compliance: Dict[str, str]) -> str:
    """Resolve target status per spec rule (3): automated → Done if cleared, else To Do."""
    src = item.get("status_source", "manifest")
    if src == "manifest":
        return item.get("status", TARGET_TODO)
    if src == "test-results":
        key = item.get("lookup_key")
        v = tests.get(key)
        return TARGET_DONE if v == "pass" else TARGET_TODO
    if src == "compliance":
        key = item.get("lookup_key")
        v = compliance.get(key)
        return TARGET_DONE if v == "NotAFinding" else TARGET_TODO
    if src == "git":
        # Git lookup is best-effort: a marker that's known to have shipped.
        # Since this script runs in CI, we accept anything in git log.
        import subprocess
        marker = item.get("git_marker", "")
        if not marker:
            return TARGET_TODO
        try:
            out = subprocess.run(
                ["git", "log", "--oneline", "-n", "200"],
                capture_output=True, text=True, cwd=REPO_ROOT, check=False,
            ).stdout
            return TARGET_DONE if marker.lower() in out.lower() else TARGET_TODO
        except Exception:
            return TARGET_TODO
    return TARGET_TODO


def build_specs() -> List[JiraIssueSpec]:
    """Compose manifest + live status into a flat list of JiraIssueSpecs."""
    epics, items = load_manifest()
    tests, compliance = load_live_statuses()
    specs: List[JiraIssueSpec] = []
    for e in epics:
        specs.append(JiraIssueSpec(
            ext_id=e["ext_id"],
            title=e["title"],
            description=e.get("description", ""),
            type="Epic",
            parent_ext_id=None,
            labels=e.get("labels", []),
            links=[],
            target_status=e.get("status", TARGET_TODO),
        ))
    for it in items:
        specs.append(JiraIssueSpec(
            ext_id=it["ext_id"],
            title=it["title"],
            description=it.get("description", ""),
            type=it["type"],
            parent_ext_id=it.get("parent_ext_id"),
            labels=it.get("labels", []),
            links=it.get("links", []) or [],
            target_status=resolve_status(it, tests, compliance),
        ))
    return specs


# ── ADF (Atlassian Document Format) helpers ─────────────────────────────────

def to_adf(text: str) -> dict:
    """Bare-minimum ADF wrapper for a multi-line plain text description.

    Jira Cloud REST v3 wants ADF, not raw markdown. We convert each paragraph
    of `text` to an ADF `paragraph` node. Bullets are detected by a leading
    `- ` and rendered as bulletList.
    """
    blocks: List[dict] = []
    cur_list: List[str] = []
    for raw in text.split("\n"):
        line = raw.rstrip()
        if line.startswith("- "):
            cur_list.append(line[2:])
            continue
        if cur_list:
            blocks.append({
                "type": "bulletList",
                "content": [
                    {"type": "listItem", "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": li}]}
                    ]} for li in cur_list
                ],
            })
            cur_list = []
        if line.strip() == "":
            continue
        blocks.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": line}],
        })
    if cur_list:
        blocks.append({
            "type": "bulletList",
            "content": [
                {"type": "listItem", "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": li}]}
                ]} for li in cur_list
            ],
        })
    return {"version": 1, "type": "doc", "content": blocks or [{"type": "paragraph", "content": [{"type": "text", "text": " "}]}]}


# ── Jira client ─────────────────────────────────────────────────────────────

class JiraClient:
    """Minimal Jira Cloud REST v3 client with retry/backoff."""
    def __init__(self, base_url: str, email: str, token: str):
        self.base_url = base_url.rstrip("/")
        auth = base64.b64encode(f"{email}:{token}".encode()).decode()
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Basic {auth}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "loadlead-jira-sync/1.0",
        })

    def _req(self, method: str, path: str, **kw) -> requests.Response:
        url = f"{self.base_url}/{path.lstrip('/')}"
        for attempt in range(5):
            r = self.session.request(method, url, timeout=30, **kw)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 2 ** attempt))
                print(f"  rate-limited; waiting {wait}s")
                time.sleep(wait)
                continue
            if 500 <= r.status_code < 600 and attempt < 4:
                time.sleep(2 ** attempt)
                continue
            return r
        return r  # last response

    # ── Discovery ────────────────────────────────────────────────────────────
    def get_create_meta(self, project_key: str) -> dict:
        r = self._req("GET", f"/rest/api/3/issue/createmeta?projectKeys={project_key}&expand=projects.issuetypes.fields")
        r.raise_for_status()
        return r.json()

    def get_transitions(self, issue_key: str) -> List[dict]:
        r = self._req("GET", f"/rest/api/3/issue/{issue_key}/transitions")
        r.raise_for_status()
        return r.json().get("transitions", [])

    def get_issue(self, issue_key: str) -> Optional[dict]:
        r = self._req("GET", f"/rest/api/3/issue/{issue_key}?fields=summary,status,labels,issuetype")
        return r.json() if r.ok else None

    # ── Search (label-based rebuild path) ────────────────────────────────────
    def search_by_label(self, label: str) -> List[dict]:
        jql = f'project = {PROJECT_KEY} AND labels = "{label}"'
        r = self._req("GET", f"/rest/api/3/search?jql={urllib.parse.quote(jql)}&fields=summary,labels")
        if not r.ok:
            return []
        return r.json().get("issues", [])

    # ── Mutations ────────────────────────────────────────────────────────────
    def create_issue(self, payload: dict) -> dict:
        r = self._req("POST", "/rest/api/3/issue", json=payload)
        if not r.ok:
            print(f"  create failed {r.status_code}: {r.text[:300]}", file=sys.stderr)
            r.raise_for_status()
        return r.json()

    def update_issue(self, key: str, payload: dict) -> None:
        r = self._req("PUT", f"/rest/api/3/issue/{key}", json=payload)
        if not r.ok:
            print(f"  update failed for {key} {r.status_code}: {r.text[:300]}", file=sys.stderr)
            r.raise_for_status()

    def transition_issue(self, key: str, transition_id: str) -> None:
        r = self._req("POST", f"/rest/api/3/issue/{key}/transitions", json={"transition": {"id": transition_id}})
        if not r.ok:
            print(f"  transition failed for {key} {r.status_code}: {r.text[:300]}", file=sys.stderr)
            r.raise_for_status()

    def link_issues(self, in_key: str, out_key: str, link_type: str = "Relates") -> None:
        body = {"type": {"name": link_type}, "inwardIssue": {"key": in_key}, "outwardIssue": {"key": out_key}}
        r = self._req("POST", "/rest/api/3/issueLink", json=body)
        if not r.ok and r.status_code != 404:  # 404 if the type doesn't exist
            print(f"  link failed {in_key}↔{out_key} {r.status_code}: {r.text[:300]}", file=sys.stderr)


# ── Planner ─────────────────────────────────────────────────────────────────

@dataclass
class Plan:
    create: List[JiraIssueSpec] = field(default_factory=list)
    update: List[Tuple[JiraIssueSpec, str]] = field(default_factory=list)   # (spec, jira_key)
    transition: List[Tuple[JiraIssueSpec, str, str, str]] = field(default_factory=list)  # (spec, key, from, to)
    skip_human: List[Tuple[JiraIssueSpec, str, str]] = field(default_factory=list)       # (spec, key, current)
    link: List[Tuple[str, str]] = field(default_factory=list)                # (from_key, to_key)


def plan_sync(specs: List[JiraIssueSpec], sync_map: Dict[str, str], jira: Optional[JiraClient]) -> Plan:
    plan = Plan()
    by_ext = {s.ext_id: s for s in specs}

    for spec in specs:
        existing_key = sync_map.get(spec.ext_id)
        if not existing_key:
            plan.create.append(spec)
            continue
        if jira is None:
            # Dry-run without Jira creds: assume issue exists, no transitions planned.
            continue
        issue = jira.get_issue(existing_key)
        if not issue:
            print(f"  warning: {spec.ext_id} mapped to {existing_key} but Jira returned 404 — will re-create", file=sys.stderr)
            plan.create.append(spec)
            continue
        cur_status = issue.get("fields", {}).get("status", {}).get("name", "")
        if spec.target_status != cur_status:
            if cur_status in HUMAN_OWNED_STATES:
                plan.skip_human.append((spec, existing_key, cur_status))
            else:
                plan.transition.append((spec, existing_key, cur_status, spec.target_status))
        # We don't push description/labels every run — only when they change. For
        # the first apply, the update happens inline with the create. For
        # subsequent runs we update only if the summary or labels differ.
        cur_summary = issue.get("fields", {}).get("summary", "")
        cur_labels = set(issue.get("fields", {}).get("labels", []))
        if spec.summary != cur_summary or cur_labels != set(spec.all_labels):
            plan.update.append((spec, existing_key))

    # Links: only between issues both in the map (otherwise the link can't be made).
    for spec in specs:
        from_key = sync_map.get(spec.ext_id)
        if not from_key:
            continue
        for target_ext_id in spec.links:
            to_key = sync_map.get(target_ext_id)
            if to_key:
                plan.link.append((from_key, to_key))

    return plan


# ── Apply ───────────────────────────────────────────────────────────────────

def apply_plan(plan: Plan, specs: List[JiraIssueSpec], sync_map: Dict[str, str], jira: JiraClient,
               project_key: str, issuetype_ids: Dict[str, str], status_transitions: Dict[str, str]) -> None:
    by_ext = {s.ext_id: s for s in specs}

    # Resolve issue-type name variants. Jira projects expose sub-tasks under
    # one of "Sub-task" / "Subtask" / "Sub-Task" depending on project type.
    # Team-managed projects sometimes don't enable sub-tasks at all — in that
    # case we fall back to "Task" with a parent link so the hierarchy survives.
    def resolve_type(t: str) -> Optional[str]:
        for cand in [t, t.replace("-", ""), t.replace("-", " "),
                     "Sub-task", "Subtask", "Sub-Task"]:
            if cand in issuetype_ids:
                return issuetype_ids[cand]
        if t in ("Sub-task", "Subtask", "Sub-Task"):
            fallback = issuetype_ids.get("Task")
            if fallback:
                print(f"  ⚠ '{t}' issuetype not in this project — falling back to Task with parent link", file=sys.stderr)
                return fallback
        return None

    # 1) Create new issues (Epics first, then Stories, then Sub-tasks — so parents exist before children)
    order = {"Epic": 0, "Story": 1, "Task": 2, "Sub-task": 3}
    creates_sorted = sorted(plan.create, key=lambda s: order.get(s.type, 9))
    for spec in creates_sorted:
        # Parent must exist before sub-task creation.
        parent_key = None
        if spec.parent_ext_id:
            parent_key = sync_map.get(spec.parent_ext_id)
            if not parent_key:
                print(f"  skipping {spec.ext_id}: parent {spec.parent_ext_id} not yet synced", file=sys.stderr)
                continue
        typeid = resolve_type(spec.type)
        if not typeid:
            print(f"  ✗ no matching issuetype for '{spec.type}' — skipping {spec.ext_id}", file=sys.stderr)
            continue
        payload: Dict[str, Any] = {
            "fields": {
                "project": {"key": project_key},
                "summary": spec.summary,
                "description": to_adf(spec.description),
                "issuetype": {"id": typeid},
                "labels": spec.all_labels,
            }
        }
        if parent_key:
            payload["fields"]["parent"] = {"key": parent_key}
        try:
            res = jira.create_issue(payload)
            key = res["key"]
            sync_map[spec.ext_id] = key
            print(f"  + created {key:10s} {spec.ext_id}")
            save_map(sync_map)  # persist after EACH success so a crash doesn't lose progress
        except Exception as ex:
            print(f"  ✗ create error {spec.ext_id}: {ex}", file=sys.stderr)

    # 2) Updates
    for spec, key in plan.update:
        try:
            jira.update_issue(key, {"fields": {"summary": spec.summary, "labels": spec.all_labels}})
            print(f"  ~ updated {key:10s} {spec.ext_id}")
        except Exception as ex:
            print(f"  ✗ update error {spec.ext_id}: {ex}", file=sys.stderr)

    # 3) Transitions
    for spec, key, frm, to in plan.transition:
        avail = jira.get_transitions(key)
        match = next((t for t in avail if t["to"]["name"] == to), None)
        if not match:
            print(f"  ✗ no transition to '{to}' available for {key}: have {[t['to']['name'] for t in avail]}", file=sys.stderr)
            continue
        try:
            jira.transition_issue(key, match["id"])
            print(f"  → transitioned {key:10s} {spec.ext_id}: {frm} → {to}")
        except Exception as ex:
            print(f"  ✗ transition error {spec.ext_id}: {ex}", file=sys.stderr)

    # 4) Links (best-effort)
    for from_key, to_key in plan.link:
        jira.link_issues(from_key, to_key, "Relates")


# ── Sync map I/O ────────────────────────────────────────────────────────────

def load_map() -> Dict[str, str]:
    if not SYNC_MAP.exists():
        return {}
    with SYNC_MAP.open() as f:
        return json.load(f)


def save_map(m: Dict[str, str]) -> None:
    SYNC_MAP.parent.mkdir(parents=True, exist_ok=True)
    with SYNC_MAP.open("w") as f:
        json.dump(m, f, indent=2, sort_keys=True)


def rebuild_map_from_labels(jira: JiraClient, specs: List[JiraIssueSpec]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for spec in specs:
        norm = spec.ext_id.replace(" ", "-").replace(":", "-").lower()
        issues = jira.search_by_label(f"extid-{norm}")
        if issues:
            out[spec.ext_id] = issues[0]["key"]
    return out


# ── Main ────────────────────────────────────────────────────────────────────

def env_or_die() -> Tuple[str, str, str]:
    base = os.environ.get("JIRA_BASE_URL")
    email = os.environ.get("JIRA_EMAIL")
    token = os.environ.get("JIRA_API_TOKEN")
    if not (base and email and token):
        print("error: set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN before --apply", file=sys.stderr)
        sys.exit(1)
    return base, email, token


def discover_meta(jira: JiraClient) -> Tuple[Dict[str, str], Dict[str, str]]:
    """Pull issuetype + transition IDs by querying Jira (no hardcoded guesses)."""
    meta = jira.get_create_meta(PROJECT_KEY)
    types: Dict[str, str] = {}
    projects = meta.get("projects") or []
    if projects:
        for it in projects[0].get("issuetypes", []):
            types[it["name"]] = it["id"]
    # Transitions are per-issue — discovered lazily in apply_plan.
    return types, {}


def print_plan(plan: Plan, specs: List[JiraIssueSpec]) -> None:
    by_ext = {s.ext_id: s for s in specs}
    print(f"\n── Plan ──────────────────────────────────────────────────────────")
    print(f"  Create:     {len(plan.create)}")
    print(f"  Update:     {len(plan.update)}")
    print(f"  Transition: {len(plan.transition)}")
    print(f"  Link:       {len(plan.link)}")
    print(f"  Skipped (human-owned state): {len(plan.skip_human)}")
    if plan.create:
        print("\n  Will CREATE:")
        for s in plan.create[:30]:
            print(f"    [{s.type:9s}] {s.ext_id:32s} → {s.summary[:80]}  ({s.target_status})")
        if len(plan.create) > 30:
            print(f"    … and {len(plan.create) - 30} more")
    if plan.transition:
        print("\n  Will TRANSITION:")
        for s, k, fr, to in plan.transition[:20]:
            print(f"    {k:10s} {s.ext_id:32s}  {fr} → {to}")
    if plan.skip_human:
        print("\n  Will SKIP (human-owned state, won't clobber):")
        for s, k, cur in plan.skip_human[:20]:
            print(f"    {k:10s} {s.ext_id:32s}  current: {cur}")


def main() -> int:
    p = argparse.ArgumentParser(description="LoadLead Jira sync")
    p.add_argument("--apply", action="store_true", help="actually create/update Jira (default: dry-run)")
    p.add_argument("--only", default="", help="only sync items whose ext_id starts with this prefix (e.g. 'test')")
    p.add_argument("--rebuild-map", action="store_true", help="rebuild jira/sync-map.json from Jira labels")
    args = p.parse_args()

    specs = build_specs()
    if args.only:
        specs = [s for s in specs if s.ext_id.startswith(args.only) or s.ext_id.startswith(f"epic:{args.only}")]
        print(f"  filtered to prefix '{args.only}': {len(specs)} specs")

    sync_map = load_map()
    print(f"loaded {len(specs)} manifest specs; {len(sync_map)} known mappings in sync-map.json")

    # Status summary (before any Jira call)
    from collections import Counter
    status_counter = Counter(s.target_status for s in specs)
    print(f"target statuses: {dict(status_counter)}")

    jira: Optional[JiraClient] = None
    issuetype_ids: Dict[str, str] = {}

    if args.apply or args.rebuild_map:
        base, email, token = env_or_die()
        jira = JiraClient(base, email, token)
        issuetype_ids, _ = discover_meta(jira)
        if not issuetype_ids:
            print("error: createmeta returned no issuetypes for project — check JIRA_PROJECT_KEY", file=sys.stderr)
            return 1
        print(f"discovered issuetypes: {issuetype_ids}")

    if args.rebuild_map:
        assert jira is not None
        sync_map = rebuild_map_from_labels(jira, specs)
        save_map(sync_map)
        print(f"rebuilt sync-map.json with {len(sync_map)} mappings")
        return 0

    plan = plan_sync(specs, sync_map, jira)
    print_plan(plan, specs)

    if not args.apply:
        print("\n── DRY-RUN: nothing was sent to Jira. Use --apply to execute. ──")
        return 0

    assert jira is not None
    apply_plan(plan, specs, sync_map, jira, PROJECT_KEY, issuetype_ids, {})
    save_map(sync_map)
    print(f"\nsync-map.json: {len(sync_map)} mappings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
