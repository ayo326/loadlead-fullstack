# Jira Smart Commits — LoadLead Convention

This repo uses Atlassian's [Smart Commits](https://confluence.atlassian.com/fisheye/using-smart-commits-298976812.html)
to link every commit, branch, and deploy back to the SCRUM Jira project.

## ⚠️ Prerequisites (state them, don't assume)

Smart Commits do nothing unless **all three** of these are true:

1. **The "GitHub for Jira" app is installed** on your Atlassian site
   (`atlassian.net`) and active.
2. **The `loadlead-fullstack` GitHub repo is connected** to that integration
   (Settings → Apps → GitHub for Jira → repos).
3. **Your GitHub commit-email is linked to your Atlassian account** —
   otherwise Jira can identify the commit but can't attribute it.

Without these, the convention below is **inert** — your commit messages will
work fine for git, but Jira won't link/comment/transition anything. Verify by
opening any existing issue and looking for a "Development" panel showing
linked commits. No panel? The integration isn't connected yet.

---

## The format

Every commit's first line should start with one or more SCRUM keys, then a
short summary. Smart Commit commands may follow inline:

```
SCRUM-<n>: <summary>
SCRUM-<n> #<command> [args]
SCRUM-<n> SCRUM-<m> deploy: <env>   # multiple keys allowed
```

### Supported commands

| Command       | Effect                                          |
|---------------|-------------------------------------------------|
| (no command)  | Just link the commit to the issue.             |
| `#comment X`  | Add a comment to the issue.                    |
| `#time 1h 30m`| Log time on the issue.                          |
| `#to-do`      | Transition to **To Do**.                        |
| `#in-progress`| Transition to **In Progress**.                  |
| `#in-review`  | Transition to **In Review**.                    |
| `#done`       | Transition to **Done**.                         |

The transition keywords are derived from this board's workflow names —
lowercased, spaces replaced with hyphens. Verify in your project's workflow
viewer if you ever add a state.

---

## Examples

```text
SCRUM-12: implement resolveCarrierOfRecord precedence

SCRUM-12 #in-progress wiring carrier-of-record into requireVerifiedCarrier

SCRUM-45 #done #time 2h #comment FMCSA stub added for staging

SCRUM-12 SCRUM-45 deploy: staging release        # links both issues, no transition
```

---

## Local enforcement

### Install once

```bash
bash scripts/hooks/install.sh
```

This drops:
- `.git/hooks/commit-msg` — the warn/block hook
- `git config commit.template .gitmessage` — so `git commit` opens with the
  template populated.

### Default behaviour

**WARN, don't block.** A commit without a SCRUM key still goes through, but
prints:

```
⚠ no SCRUM-<n> key found in commit message — Jira will not link this commit.
  Add a key on the first line: "SCRUM-123: <summary>"
  (Warning only. Set JIRA_COMMIT_ENFORCE=block to require.)
```

### Hard enforcement (opt-in)

```bash
export JIRA_COMMIT_ENFORCE=block
```

Set in your shell, or in CI. With this set, a commit without a SCRUM key
fails with exit 1.

### Typo detection

The hook also catches `#command` typos (it can't tell Jira "did you mean…",
but it can warn before you push):

```text
SCRUM-12: thing #imn-progress wiring
⚠ unrecognised Smart Commit command(s): #imn-progress
  Valid: #comment <text> | #time 1h 30m | #to-do | #in-progress | #in-review | #done
```

---

## Server-side enforcement (CI)

Pull requests must reference at least one SCRUM key across their commit
range. This is enforced by `.github/workflows/pr-jira-ref.yml` — see
that file. A PR with no `SCRUM-<n>` in any commit message fails the
"Jira reference" status check and cannot merge.

---

## Sync vs Smart Commit transitions

The Jira sync (`jira/sync.py`) and Smart Commit transitions are designed
to coexist without stepping on each other:

- **Sync may move issues** between `To Do` and `Done` based on automated
  status (test results, compliance findings).
- **Sync MUST NOT touch** `In Progress` or `In Review` — those are
  human-owned states. The sync logs and skips them.
- **Smart Commit transitions are developer intent** and may move issues
  into ANY state, including `In Progress` / `In Review`. That's the
  sanctioned way to move those states.
- There is no conflict: once a developer marks `SCRUM-12 #in-progress`,
  the sync will not push it back to `To Do` on the next run — it sees
  the human-owned state and skips.

---

## Deploy hook (aggregated comments)

The deploy hooks (`deploy-backend.sh`, `deploy-frontend.sh`) parse the
SCRUM keys across the commit range since the last deploy tag and:

1. Link every referenced SCRUM key (no transition — that's developer intent).
2. Post **ONE aggregated comment** like:
   ```
   Deployed to staging @ <sha> — <DEPLOY_MSG>
   ```
   The comment is posted as a top-level deployment record, not fanned out
   one-per-issue. (Fanning out spams everyone watching multiple issues.)
3. Tag the deployed commit (`deploy/<env>/<sha>`) so the next deploy's
   range is correct.

Prod deploys require `DEPLOY_MSG`; staging/dev are optional.

---

## FAQ

**Q: I forgot to add a SCRUM key to my last commit.**
- Amend it: `git commit --amend` and edit the first line. The hook
  re-runs on amend.
- Or add the key to a follow-up commit; both will be parsed.

**Q: I'm reverting a commit. What should the message look like?**
- `Revert "SCRUM-12: original summary"` is fine — the key is preserved
  in the quoted original message and Jira will link the revert.

**Q: My commit covers multiple issues.**
- Put every key on the first line: `SCRUM-12 SCRUM-45 fix: shared dep upgrade`.
  All issues get the link.

**Q: I want to log time without transitioning.**
- `SCRUM-12 #time 2h #comment finished investigation`. No transition keyword
  = no transition.
