# Jira Sync

Idempotent, dry-run-by-default sync of `jira/work-manifest.yaml` (+ live status
sources) into the Jira Cloud Scrum project. See the module docstring in
[`sync.py`](sync.py) for the full contract.

## Setup

```bash
# 1. Install deps (PyYAML + requests):
/usr/bin/python3 -m pip install --user -r jira/requirements.txt

# 2. Auth comes from env only (never from files in the repo):
export JIRA_BASE_URL=https://<your-site>.atlassian.net
export JIRA_EMAIL=<your atlassian email>
export JIRA_API_TOKEN=<token from id.atlassian.com/manage-profile/security/api-tokens>
```

> ⚠️ **Use `/usr/bin/python3` (Apple's 3.9), not the default `python3`.** On this
> machine the Homebrew **Python 3.14** has a broken `pyexpat` (it links the old
> system `libexpat`, missing newer symbols), so `pip` and `import yaml` fail
> under it. Apple's `/usr/bin/python3` works. To repair the default instead:
> `brew install expat && brew reinstall python@3.14`.
>
> Don't run the script as `./jira/sync.py` either — it isn't `chmod +x`, and its
> `#!/usr/bin/env python3` shebang would pick the broken interpreter. Always
> invoke it through `/usr/bin/python3`.

## Usage

```bash
/usr/bin/python3 jira/sync.py                      # dry-run (default — safe, prints the plan)
/usr/bin/python3 jira/sync.py --apply              # actually create/update issues
/usr/bin/python3 jira/sync.py --apply --only test  # only ext_ids starting with `test:`
/usr/bin/python3 jira/sync.py --rebuild-map        # rebuild sync-map.json from Jira labels
```

**Always run the dry-run first** to confirm the token authenticates (no 401) and
the plan is what you expect, *then* add `--apply` (which writes to live Jira).

## Guardrails (enforced by `sync.py`)

- Dry-run by default; writes only with `--apply`.
- Moves issues only between **To Do** / **Done** from automated status — never
  overrides human-owned **In Progress** / **In Review**.
- Auth from env only; never reads/writes credentials from repo files.
- Never puts secrets, tokens, or PII in Jira descriptions.

## Files

| File | Purpose |
|---|---|
| `sync.py` | The sync engine (plan/apply/rebuild-map). |
| `post-deploy.py` | Post-deploy status hook. |
| `work-manifest.yaml` | Source-of-truth backlog → Jira issues. |
| `sync-map.json` | `ext_id → Jira key` map (idempotency). |
| `requirements.txt` | Python deps (PyYAML, requests). |
