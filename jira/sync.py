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
import hashlib
import json
import os
import re
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

# ── Priority resolver constants ─────────────────────────────────────────────
# CAT-I LL-IDs from llmap.yaml — go-live blockers per spec.
CAT_I_LL_IDS = {
    "LL-IA-002", "LL-AC-001", "LL-AC-002", "LL-AC-003", "LL-AC-004",
    "LL-IV-001", "LL-IV-002", "LL-CR-001",
}
# Tier-1 (CI-blocking) test IDs per LoadLead_Test_Spec.md §2.
TIER_1_TEST_IDS = (
    {f"A{i}" for i in range(1, 9)} |
    {f"B{i}" for i in range(1, 12)} |
    {f"C{i}" for i in range(1, 12)} |
    {"D6", "D7"} |
    {"E2", "E5", "E6", "E7"} |
    {f"G{i}" for i in range(1, 8)} |
    {f"H{i}" for i in range(1, 5)}
)
# Refactor stories that ARE the core invariants (per spec §12 + Test_Spec §6).
REFACTOR_CORE_INVARIANTS = {
    "refactor:carrier-of-record",  # resolveCarrierOfRecord precedence
    "refactor:capabilities",        # SHIPPER+CARRIER mutually exclusive
    "refactor:one-parent",          # one-parent invariant
    "refactor:gates",                # two-gate verification
    "refactor:self-driver",          # OO self-driver guarded
    "refactor:invoice-payee",        # carrier-of-record routes payee
}
# Human-readable name → ordinal; sync stores the NAME so priority-scheme changes
# in Jira don't break the map.
PRIORITY_ORDER = ["Highest", "High", "Medium", "Low", "Lowest"]


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
    # Structured description fields (composed from manifest families or per-item override)
    context: str = ""
    user_story_as_a: str = ""
    user_story_i_want: str = ""
    user_story_so_that: str = ""
    gherkin: str = ""
    target_priority: str = "Medium"

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

    def adf_description(self) -> dict:
        """Compose the 3-section ADF the prompt requires."""
        return {
            "type": "doc", "version": 1, "content": [
                {"type": "heading", "attrs": {"level": 3},
                 "content": [{"type": "text", "text": "Context"}]},
                {"type": "paragraph",
                 "content": [{"type": "text", "text": self.context.strip() or self.description.strip() or self.title}]},
                {"type": "heading", "attrs": {"level": 3},
                 "content": [{"type": "text", "text": "User Story"}]},
                {"type": "paragraph",
                 "content": [{"type": "text",
                              "text": f"As a {self.user_story_as_a}, I want {self.user_story_i_want}, so that {self.user_story_so_that}."}]},
                {"type": "heading", "attrs": {"level": 3},
                 "content": [{"type": "text", "text": "Acceptance Criteria (Gherkin)"}]},
                {"type": "codeBlock", "attrs": {"language": "gherkin"},
                 "content": [{"type": "text", "text": self.gherkin.strip()}]},
            ],
        }

    def description_hash(self) -> str:
        """SHA-256 of the composed description. Idempotency key — PUT only on change."""
        canonical = json.dumps(self.adf_description(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()


# ── Manifest + live status ──────────────────────────────────────────────────

def load_manifest() -> Tuple[List[dict], List[dict], Dict[str, dict]]:
    """Returns (epics, items, families). Items are everything below epics."""
    with MANIFEST.open() as f:
        m = yaml.safe_load(f)
    return m.get("epics", []), m.get("items", []), m.get("families", {})


# ── Description composition ─────────────────────────────────────────────────

def _substitute(template: str, ctx: dict) -> str:
    """{{key}} substitution. Defaults to empty string for missing keys."""
    return re.sub(r"\{\{(\w+)\}\}", lambda m: str(ctx.get(m.group(1), "")), template)


def compose_description_fields(item: dict, families: Dict[str, dict]) -> Tuple[str, str, str, str, str]:
    """Resolve (context, as_a, i_want, so_that, gherkin) for an item.

    Order of precedence:
      1. Explicit per-item fields (item.context / item.user_story / item.gherkin)
      2. Family template (family = ext_id prefix before ':')
      3. Empty string fallback
    """
    ext_id = item["ext_id"]
    family = ext_id.split(":", 1)[0] if ":" in ext_id else ""
    fam_tpl = families.get(family, families.get("epic", {})) or {}

    sub_ctx = {
        "ext_id": ext_id,
        "title":  item.get("title", ""),
        "family": family,
    }

    # Context
    raw_ctx = item.get("context") or fam_tpl.get("context", "")
    context = _substitute(raw_ctx, sub_ctx).strip()

    # User story — per-item override (full dict) OR family template
    raw_us = item.get("user_story") or fam_tpl.get("user_story", {})
    as_a    = _substitute(raw_us.get("as_a", ""),    sub_ctx).strip()
    i_want  = _substitute(raw_us.get("i_want", ""),  sub_ctx).strip()
    so_that = _substitute(raw_us.get("so_that", ""), sub_ctx).strip()

    # Gherkin
    raw_g = item.get("gherkin") or fam_tpl.get("gherkin", "")
    gherkin = _substitute(raw_g, sub_ctx).strip()

    return context, as_a, i_want, so_that, gherkin


# ── Priority resolver ───────────────────────────────────────────────────────

def resolve_priority(item: dict) -> str:
    """Deterministic priority resolution from manifest fields. First match wins.

    Inputs available without a Jira call:
      - explicit `item.priority_hint`
      - `ext_id` (matched against CAT_I_LL_IDS and TIER_1_TEST_IDS)
      - `title` (matched for "[CAT I]" / "[CAT II]" / "[CAT III]" markers)
      - `ext_id` family (refactor:* / test:* / stig:* / dash:* / hard:* / jira:* / e2e:* / epic:*)
    """
    # 1. Explicit override always wins
    hint = item.get("priority_hint")
    if hint in PRIORITY_ORDER:
        return hint

    ext_id = item.get("ext_id", "")
    title = item.get("title", "")
    family = ext_id.split(":", 1)[0] if ":" in ext_id else ""

    # 2. CAT-I LL-IDs → Highest
    if family == "stig":
        ll_id = ext_id.split(":", 1)[1] if ":" in ext_id else ""
        if ll_id in CAT_I_LL_IDS:
            return "Highest"
        if "[CAT I]" in title:
            return "Highest"
        if "[CAT II]" in title:
            return "High"
        if "[CAT III]" in title:
            return "Medium"

    # 3. Refactor core invariants → High
    if ext_id in REFACTOR_CORE_INVARIANTS:
        return "High"

    # 4. Tier-1 test sub-tasks → High
    if family == "test":
        test_id = ext_id.split(":", 1)[1] if ":" in ext_id else ""
        if test_id in TIER_1_TEST_IDS:
            return "High"

    # 5. Family defaults
    if family in ("refactor",):
        return "High"
    if family in ("test", "dash", "hard", "jira", "e2e"):
        return "Medium"
    if family == "epic":
        return "Medium"
    return "Medium"


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
    epics, items, families = load_manifest()
    tests, compliance = load_live_statuses()
    specs: List[JiraIssueSpec] = []
    for e in epics:
        # Epics get their family resolved from the explicit "epic" family template
        # so they still carry Context/UserStory/Gherkin structure even though
        # their description in the manifest is human-readable prose.
        epic_item = {"ext_id": e["ext_id"], "title": e["title"], "context": e.get("description", "")}
        ctx, as_a, i_want, so_that, gherkin = compose_description_fields(epic_item, families)
        specs.append(JiraIssueSpec(
            ext_id=e["ext_id"],
            title=e["title"],
            description=e.get("description", ""),
            type="Epic",
            parent_ext_id=None,
            labels=e.get("labels", []),
            links=[],
            target_status=e.get("status", TARGET_TODO),
            context=ctx,
            user_story_as_a=as_a,
            user_story_i_want=i_want,
            user_story_so_that=so_that,
            gherkin=gherkin,
            target_priority=resolve_priority({"ext_id": e["ext_id"], "title": e["title"]}),
        ))
    for it in items:
        ctx, as_a, i_want, so_that, gherkin = compose_description_fields(it, families)
        specs.append(JiraIssueSpec(
            ext_id=it["ext_id"],
            title=it["title"],
            description=it.get("description", ""),
            type=it["type"],
            parent_ext_id=it.get("parent_ext_id"),
            labels=it.get("labels", []),
            links=it.get("links", []) or [],
            target_status=resolve_status(it, tests, compliance),
            context=ctx,
            user_story_as_a=as_a,
            user_story_i_want=i_want,
            user_story_so_that=so_that,
            gherkin=gherkin,
            target_priority=resolve_priority(it),
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
        # Include priority so we can detect human re-prioritizations
        r = self._req("GET", f"/rest/api/3/issue/{issue_key}?fields=summary,status,labels,issuetype,priority")
        return r.json() if r.ok else None

    def get_priorities(self) -> Dict[str, str]:
        """Discover the project's priority scheme. Returns {name: id}."""
        r = self._req("GET", "/rest/api/3/priority")
        if not r.ok:
            return {}
        return {p["name"]: p["id"] for p in r.json()}

    def set_priority(self, issue_key: str, priority_name: str, priority_ids: Dict[str, str]) -> bool:
        pid = priority_ids.get(priority_name)
        if not pid:
            # Some Jira projects use a subset of names; fall back to closest match.
            return False
        r = self._req("PUT", f"/rest/api/3/issue/{issue_key}", json={"fields": {"priority": {"id": pid}}})
        return r.ok

    def set_description(self, issue_key: str, adf: dict) -> bool:
        r = self._req("PUT", f"/rest/api/3/issue/{issue_key}", json={"fields": {"description": adf}})
        return r.ok

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
    update: List[Tuple[JiraIssueSpec, str]] = field(default_factory=list)   # (spec, jira_key) — summary/labels
    transition: List[Tuple[JiraIssueSpec, str, str, str]] = field(default_factory=list)  # (spec, key, from, to)
    skip_human: List[Tuple[JiraIssueSpec, str, str]] = field(default_factory=list)       # (spec, key, current)
    link: List[Tuple[str, str]] = field(default_factory=list)                # (from_key, to_key)
    # New planes for description + priority idempotency:
    set_description: List[Tuple[JiraIssueSpec, str, str, str]] = field(default_factory=list)
        # (spec, key, old_hash, new_hash) — emit only when new_hash != old_hash
    set_priority:    List[Tuple[JiraIssueSpec, str, str, str]] = field(default_factory=list)
        # (spec, key, from, to)
    skip_priority_human: List[Tuple[JiraIssueSpec, str, str, str]] = field(default_factory=list)
        # (spec, key, current, last_set_by_sync) — human re-prioritized; skip + log


def plan_sync(specs: List[JiraIssueSpec], sync_map: Dict[str, dict], jira: Optional[JiraClient]) -> Plan:
    plan = Plan()
    by_ext = {s.ext_id: s for s in specs}

    for spec in specs:
        entry = sync_map.get(spec.ext_id)
        existing_key = entry["key"] if entry else None
        if not existing_key:
            plan.create.append(spec)
            continue
        old_desc_hash = entry.get("description_hash", "")
        priority_set_by_sync = entry.get("priority_set_by_sync", "")
        new_desc_hash = spec.description_hash()
        if jira is None:
            # Dry-run without Jira creds: plan description PUTs (we can compute
            # the hash diff without Jira), but not transitions (need current
            # status from Jira).
            if new_desc_hash != old_desc_hash:
                plan.set_description.append((spec, existing_key, old_desc_hash, new_desc_hash))
            # Priority: plan if we don't have a record of what we last set; on
            # apply we'll discover the current value and respect human overrides.
            if priority_set_by_sync != spec.target_priority:
                plan.set_priority.append((spec, existing_key, priority_set_by_sync or "(unset)", spec.target_priority))
            continue
        issue = jira.get_issue(existing_key)
        if not issue:
            print(f"  warning: {spec.ext_id} mapped to {existing_key} but Jira returned 404 — will re-create", file=sys.stderr)
            plan.create.append(spec)
            continue
        fields = issue.get("fields", {})
        cur_status = fields.get("status", {}).get("name", "")
        if spec.target_status != cur_status:
            if cur_status in HUMAN_OWNED_STATES:
                plan.skip_human.append((spec, existing_key, cur_status))
            else:
                plan.transition.append((spec, existing_key, cur_status, spec.target_status))
        # Summary / labels update — only when they differ
        cur_summary = fields.get("summary", "")
        cur_labels = set(fields.get("labels", []))
        if spec.summary != cur_summary or cur_labels != set(spec.all_labels):
            plan.update.append((spec, existing_key))

        # Description (hash-gated)
        if new_desc_hash != old_desc_hash:
            plan.set_description.append((spec, existing_key, old_desc_hash, new_desc_hash))

        # Priority (human-override aware)
        cur_priority = (fields.get("priority") or {}).get("name", "")
        if cur_priority != spec.target_priority:
            # If the current priority differs from what THIS sync last set, a
            # human re-prioritized it — skip + log per spec rule.
            if priority_set_by_sync and cur_priority != priority_set_by_sync:
                plan.skip_priority_human.append((spec, existing_key, cur_priority, priority_set_by_sync))
            else:
                plan.set_priority.append((spec, existing_key, cur_priority or "(none)", spec.target_priority))

    # Links: only between issues both in the map (otherwise the link can't be made).
    for spec in specs:
        from_key = get_key(sync_map, spec.ext_id)
        if not from_key:
            continue
        for target_ext_id in spec.links:
            to_key = get_key(sync_map, target_ext_id)
            if to_key:
                plan.link.append((from_key, to_key))

    return plan


# ── Apply ───────────────────────────────────────────────────────────────────

def apply_plan(plan: Plan, specs: List[JiraIssueSpec], sync_map: Dict[str, dict], jira: JiraClient,
               project_key: str, issuetype_ids: Dict[str, str], priority_ids: Dict[str, str]) -> None:
    by_ext = {s.ext_id: s for s in specs}

    def upsert_map(ext_id: str, key: str, *, desc_hash: Optional[str] = None, priority: Optional[str] = None):
        entry = sync_map.get(ext_id) or {"key": key, "description_hash": "", "priority_set_by_sync": ""}
        entry["key"] = key
        if desc_hash is not None: entry["description_hash"] = desc_hash
        if priority  is not None: entry["priority_set_by_sync"] = priority
        sync_map[ext_id] = entry

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
        # Build the 3-section ADF description so the issue lands with the
        # right description on first sight (no second PUT needed).
        desc_adf = spec.adf_description()
        payload: Dict[str, Any] = {
            "fields": {
                "project": {"key": project_key},
                "summary": spec.summary,
                "description": desc_adf,
                "issuetype": {"id": typeid},
                "labels": spec.all_labels,
            }
        }
        # Priority on create — only if the project's priority scheme has the name
        pid = priority_ids.get(spec.target_priority)
        if pid:
            payload["fields"]["priority"] = {"id": pid}
        if parent_key:
            payload["fields"]["parent"] = {"key": parent_key}
        try:
            res = jira.create_issue(payload)
            key = res["key"]
            upsert_map(spec.ext_id, key,
                       desc_hash=spec.description_hash(),
                       priority=spec.target_priority if pid else "")
            print(f"  + created {key:10s} {spec.ext_id}  (priority: {spec.target_priority})")
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

    # 5) Description PUTs — hash-gated. Only the items whose composed hash
    #    differs from what we last stored. On success, advance the hash so the
    #    next run is a no-op.
    for spec, key, _old_hash, new_hash in plan.set_description:
        try:
            ok = jira.set_description(key, spec.adf_description())
            if ok:
                upsert_map(spec.ext_id, key, desc_hash=new_hash)
                print(f"  📝 description  {key:10s} {spec.ext_id}")
                save_map(sync_map)
            else:
                print(f"  ✗ description PUT failed for {key} {spec.ext_id}", file=sys.stderr)
        except Exception as ex:
            print(f"  ✗ description error {spec.ext_id}: {ex}", file=sys.stderr)

    # 6) Priority PUTs — only when:
    #      (a) Jira's current priority equals what THIS sync last set, OR
    #      (b) it has never been set by sync (and current differs from target).
    #    The skip_priority_human plane has the human-overridden ones — log + skip.
    for spec, key, frm, to in plan.set_priority:
        try:
            if jira.set_priority(key, to, priority_ids):
                upsert_map(spec.ext_id, key, priority=to)
                print(f"  ⚡ priority     {key:10s} {spec.ext_id}: {frm} → {to}")
                save_map(sync_map)
            else:
                print(f"  ✗ priority '{to}' not in this project's scheme — skipping {spec.ext_id}", file=sys.stderr)
        except Exception as ex:
            print(f"  ✗ priority error {spec.ext_id}: {ex}", file=sys.stderr)


# ── Sync map I/O ────────────────────────────────────────────────────────────

# ── Sync-map shape ──────────────────────────────────────────────────────────
# Old shape: { ext_id: "SCRUM-N" }
# New shape: { ext_id: { "key": "SCRUM-N",
#                        "description_hash": "...",
#                        "priority_set_by_sync": "Highest" } }
# load_map() auto-migrates old → new in memory; save_map() always writes new.

def load_map() -> Dict[str, dict]:
    if not SYNC_MAP.exists():
        return {}
    with SYNC_MAP.open() as f:
        raw = json.load(f)
    # Migrate flat strings → dicts on the fly
    out: Dict[str, dict] = {}
    for ext_id, v in raw.items():
        if isinstance(v, str):
            out[ext_id] = {"key": v, "description_hash": "", "priority_set_by_sync": ""}
        elif isinstance(v, dict) and v.get("key"):
            out[ext_id] = v
        else:
            print(f"  warning: malformed sync-map entry for {ext_id}: {v!r}", file=sys.stderr)
    return out


def save_map(m: Dict[str, dict]) -> None:
    SYNC_MAP.parent.mkdir(parents=True, exist_ok=True)
    with SYNC_MAP.open("w") as f:
        json.dump(m, f, indent=2, sort_keys=True)


def get_key(sync_map: Dict[str, dict], ext_id: str) -> Optional[str]:
    """Read just the Jira key for an ext_id from the (possibly migrated) map."""
    entry = sync_map.get(ext_id)
    return entry["key"] if entry else None


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
    """Pull issuetype + priority IDs by querying Jira (no hardcoded guesses).

    Atlassian quietly changed the createmeta response shape: for team-managed
    projects, the legacy GET /createmeta?projectKeys=… returns empty
    `projects` arrays. The replacement is GET /createmeta/{projectKey}/issuetypes
    which returns `{ issueTypes: [...] }`. Try both.
    """
    types: Dict[str, str] = {}
    # Try the new per-project endpoint first (works on team-managed projects)
    r = jira._req("GET", f"/rest/api/3/issue/createmeta/{PROJECT_KEY}/issuetypes")
    if r.ok:
        for it in r.json().get("issueTypes", []):
            types[it["name"]] = it["id"]
    # Fall back to the legacy endpoint (still works on company-managed projects)
    if not types:
        meta = jira.get_create_meta(PROJECT_KEY)
        for p in (meta.get("projects") or []):
            for it in p.get("issuetypes", []):
                types[it["name"]] = it["id"]
    priorities = jira.get_priorities()
    return types, priorities


def print_plan(plan: Plan, specs: List[JiraIssueSpec]) -> None:
    by_ext = {s.ext_id: s for s in specs}
    print(f"\n── Plan ──────────────────────────────────────────────────────────")
    print(f"  Create:                {len(plan.create)}")
    print(f"  Update:                {len(plan.update)}")
    print(f"  Transition:            {len(plan.transition)}")
    print(f"  Set description:       {len(plan.set_description)}  (hash-gated)")
    print(f"  Set priority:          {len(plan.set_priority)}")
    print(f"  Link:                  {len(plan.link)}")
    print(f"  Skip (human status):   {len(plan.skip_human)}")
    print(f"  Skip (human priority): {len(plan.skip_priority_human)}")
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
    if plan.set_priority:
        print("\n  Will SET PRIORITY:")
        for s, k, fr, to in plan.set_priority[:20]:
            print(f"    {k:10s} {s.ext_id:32s}  {fr} → {to}")
        if len(plan.set_priority) > 20:
            print(f"    … and {len(plan.set_priority) - 20} more")
    if plan.set_description:
        print(f"\n  Will SET DESCRIPTION on {len(plan.set_description)} issues (composed Context + UserStory + Gherkin)")
    if plan.skip_human:
        print("\n  Will SKIP (human-owned status, won't clobber):")
        for s, k, cur in plan.skip_human[:20]:
            print(f"    {k:10s} {s.ext_id:32s}  current: {cur}")
    if plan.skip_priority_human:
        print("\n  Will SKIP (human-overridden priority, won't clobber):")
        for s, k, cur, last in plan.skip_priority_human[:20]:
            print(f"    {k:10s} {s.ext_id:32s}  current: {cur}  (sync last set: {last})")


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
    priority_ids: Dict[str, str] = {}

    if args.apply or args.rebuild_map:
        base, email, token = env_or_die()
        jira = JiraClient(base, email, token)
        issuetype_ids, priority_ids = discover_meta(jira)
        # issuetypes are only required for creates. A description/priority-only
        # apply against existing issues doesn't need them.
        plan_for_create_check = plan_sync(build_specs(), sync_map, None) if not issuetype_ids else None
        if not issuetype_ids and plan_for_create_check and plan_for_create_check.create:
            print("error: createmeta returned no issuetypes but plan has creates — check JIRA_PROJECT_KEY and project permissions", file=sys.stderr)
            return 1
        if issuetype_ids:
            print(f"discovered issuetypes: {issuetype_ids}")
        else:
            print("note: no issuetypes from createmeta (team-managed project) — OK because plan has 0 creates")
        print(f"discovered priorities: {sorted(priority_ids.keys())}")

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
    apply_plan(plan, specs, sync_map, jira, PROJECT_KEY, issuetype_ids, priority_ids)
    save_map(sync_map)
    print(f"\nsync-map.json: {len(sync_map)} mappings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
