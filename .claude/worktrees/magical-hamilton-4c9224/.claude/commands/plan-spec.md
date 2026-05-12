---
description: Create a structured spec document for a feature, in plan mode
---

We are creating a SPEC.md document for the feature: $ARGUMENTS

Don't write any code yet. Instead, produce a structured spec that includes:

1. **Goal**: What this feature accomplishes (1 paragraph)
2. **Non-goals**: What this feature explicitly does NOT do
3. **User-facing behavior**: How Marcel/team will interact with it
4. **Data model changes**: New/modified Drizzle schemas
5. **API surface**: New endpoints and their contracts
6. **Pipeline steps affected**: New/modified pipeline steps
7. **Frontend screens/components**: New/modified Quasar components
8. **External dependencies**: Any new APIs, packages, services
9. **Cost implications**: Estimated per-run cost, where cost-tracker hooks
10. **Testing strategy**: What we test, how
11. **Implementation order**: Sequenced task list, smallest possible chunks
12. **Open questions**: Things that need decisions before implementation
13. **Splitting plan**: How this spec divides into isolated implementation chunks (each chunk = one fresh Claude Code session)

Save the document to /specs/<phase>-<feature>.md where phase is determined by current state.

After saving, ask Marcel to review and approve before any implementation begins.
