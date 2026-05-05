---
description: Catch me up on the current state after a /clear or context loss
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git status:*), Read
---

Provide a concise catch-up:

1. Current branch: `git branch --show-current`
2. Last 5 commits: `git log --oneline -5`
3. Uncommitted changes: `git status` + `git diff --stat`
4. Active spec being worked on: scan /specs/ for most recently modified
5. Recommended next action based on the spec's "Implementation order"

Output in this format:
