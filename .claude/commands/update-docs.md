---
description: Update CLAUDE.md and spec files after a successful task
allowed-tools: Read, Edit, Bash(git diff:*)
---

Review changes from the just-completed task:

1. Did we introduce a new pattern that other tasks should follow?
   → Update relevant CLAUDE.md (root or subtree)

2. Did we discover something the spec should have covered?
   → Add a "Discovered During Implementation" section to the spec

3. Did we make a deviation from the original spec?
   → Update the spec to reflect reality, add a "Deviations" section explaining why

4. Did we hit a footgun or gotcha?
   → Add to "Common Mistakes to Avoid" in the relevant CLAUDE.md

5. Did we add a new external dependency?
   → Update the root CLAUDE.md "Tech Stack" section

Keep updates concise. Don't add noise. CLAUDE.md files should remain readable in <2 minutes.
