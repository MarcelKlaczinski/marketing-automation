# Claude Code Bauanleitung: Marketing Automation Platform

**Anleitung für Marcel zur Steuerung von Claude Code beim Bau der Plattform**

Dieses Dokument beschreibt die exakte Reihenfolge und Methodik, wie du die Marketing-Automation-Plattform mit Claude Code in 4 Wochen baust. Es kombiniert: Spec-Driven Development, Plan-Mode-First, Custom Commands, Sub-Agents, fresh sessions pro Task. Das ist kein Plan zum Lesen für dich – es ist eine Arbeitsanleitung mit konkreten Prompts, Commands und Reihenfolgen.

---

## Teil A: Setup & Mental Model

### A.1 Wie wir mit Claude Code arbeiten

Drei Prinzipien, die alles tragen:

**Prinzip 1: Spec ist Source of Truth, nicht der Chat-Verlauf.**
Jede größere Einheit beginnt mit einem `SPEC.md`-Dokument, das gemeinsam mit Claude Code geplant und in den Repo committed wird. Code wird *aus* der Spec gebaut, nicht aus Konversationen entwickelt. Wenn die Session degeneriert, lädst du in einer frischen Session die Spec neu und arbeitest weiter.

**Prinzip 2: Ein Task = eine Session.**
Sobald ein abgegrenzter Task fertig ist (Migration committed, Komponente fertig, Pipeline-Step implementiert), wird die Session mit `/clear` zurückgesetzt. Eine neue Session zu starten kostet ~20.000 Tokens für initiales Context-Loading, aber das ist nichts gegen die Qualitätsverluste in degenerierten Sessions. Ziel: mindestens 70% der Tasks in <50% Context-Window.

**Prinzip 3: Plan-Mode für alles, was länger als 5 Minuten dauert.**
Vor jeder nicht-trivialen Implementierung: Plan-Mode aktivieren (`Shift+Tab` zwei mal in Claude Code). Claude liest, plant, du reviewst den Plan, dann erst Approval und Auto-Accept. Anthropic-Studien sagen: Ohne Planning ~33% Erfolgsquote, mit Planning >80%.

### A.2 Repo-Initialisierung (vor allem anderen)

```bash
# Lokales Setup
mkdir marketing-automation && cd marketing-automation
git init
bun init -y                     # Bun-Workspace-Root

# Claude Code-Verzeichnisse
mkdir -p .claude/commands .claude/agents

# Marketing Skills als Submodul (Punkt 1 aus unserer Diskussion)
git submodule add https://github.com/coreyhaines31/marketingskills.git packages/skills

# Initial Commit
git add .
git commit -m "chore: initial repo setup"
```

Dann öffnest du Claude Code im Repo-Root: `claude`

In der ersten Session: `/init` ausführen. Claude scannt das (noch leere) Repo und legt eine Basis-`CLAUDE.md` an. Die wirst du danach manuell ergänzen mit dem Inhalt aus Teil B.

---

## Teil B: Die `CLAUDE.md`-Hierarchie

Du baust drei Ebenen von `CLAUDE.md`:

```
marketing-automation/
├── CLAUDE.md                          # Root: Projekt-Übersicht, harte Regeln
├── apps/
│   ├── api/CLAUDE.md                  # Backend-spezifische Regeln
│   └── web/CLAUDE.md                  # Quasar-PWA-spezifische Regeln
└── packages/
    ├── pipelines/CLAUDE.md            # Pipeline-Step-Patterns
    ├── adapters/CLAUDE.md             # Externe-API-Integration-Patterns
    └── db/CLAUDE.md                   # Drizzle-Schema-Konventionen
```

### B.1 Root `CLAUDE.md` (das wichtigste Dokument)

Das ist der Inhalt, den du nach `/init` in die Root-`CLAUDE.md` schreibst:

```markdown
# Marketing Automation Platform

## Project Overview
Multi-tenant marketing automation platform for content-driven projects.
First tenant: KI-Wissensraum (educational AI content blog).
Future tenants: Bellemann (automotive dealer), Balkonkraftwerk affiliate blog.
Designed to evolve into SaaS.

## Tech Stack (Hard Rules)
- **Runtime**: Bun (NOT Node.js)
- **Backend Framework**: Hono (NOT Express, NOT Fastify)
- **ORM**: Drizzle (NOT Prisma)
- **Database**: PostgreSQL 16 (with pgvector extension)
- **Cache + Queue**: Redis 7 + BullMQ
- **Validation**: Zod everywhere on boundaries
- **Frontend**: Quasar 2 + Vite + Vue 3 (Options API), PWA mode
- **Mobile-first**: All UI designed for mobile screens first, then desktop
- **Push Notifications**: Web Push via VAPID
- **Language**: TypeScript strict everywhere, English-only code/comments/JSDoc

## Architecture
- Hexagonal Architecture (ports & adapters), inspired by Marcel's Vanilla v3
- Multi-tenant via `project_id` foreign key (NO schema-per-tenant)
- Pipeline-Templates as classes with composable Steps
- Skills (in packages/skills) provide marketing domain knowledge
- Each pipeline step loads relevant skill MD + project context into LLM prompt

## Vue/Quasar Conventions (from Marcel's existing standards)
- Options API only (NOT Composition API, NOT script setup)
- `data: () => ({...})` arrow shorthand (NOT `data() { return {...} }`)
- Composables for shared logic (NOT mixins)
- Inputs: explicit autocomplete handling (`enableAutocomplete` prop pattern)
- All strings via i18n t() (NO hardcoded German/English strings)

## Common Mistakes to Avoid
- DO NOT use Composition API or script setup
- DO NOT install Express, Fastify, or Prisma packages
- DO NOT use synchronous file IO in pipeline workers
- DO NOT make raw fetch() calls — always use typed adapter clients
- DO NOT skip Zod validation on tool boundaries
- DO NOT commit secrets — use .env, encrypted in db for tenant credentials
- DO NOT touch /packages/skills directly (it's a git submodule, fork it if you need changes)
- DO NOT add new pipeline steps without writing them to follow the BaseStep contract
- DO NOT bypass the cost-tracker — every external API call must log

## Workflow
1. Check the spec file referenced in the prompt before coding
2. Read relevant CLAUDE.md files (root + nearest subdirectory)
3. Plan first if task is non-trivial — ask "should I enter plan mode?"
4. Implement the change
5. Run /review-task before declaring done
6. Run /update-docs if patterns changed

## Spec Files
All specs live in /specs/. Reference format: `/specs/<phase>-<feature>.md`
Current active specs:
- /specs/00-foundation.md
- /specs/01-cold-start-pipeline.md
- (more added as we progress)

## Key Project Context
- Marcel is solo dev + small team (1-3 people)
- Mobile-first because Marcel approves content on the go
- Quality > speed of generation (we approve before publish)
- Cost monitoring is mission-critical (hard limits, kill-switch)
- Marketing Skills repo is the prompt-foundation; we orchestrate, skills define WHAT
```

### B.2 Subtree `CLAUDE.md` Files

Diese werden Claude Code automatisch beim Lesen relevanter Verzeichnisse mit-kontextualisieren. Sie sollen **kurz und spezifisch** sein – nicht die Root-Regeln wiederholen.

Beispiel `apps/api/CLAUDE.md`:
```markdown
# Backend API Conventions

## Structure
- routes/        HTTP endpoints (Hono routes), thin glue
- workers/       BullMQ workers (heavy lifting)
- webhooks/      Inbound webhooks (Telegram, Stripe later)
- middleware/    Hono middleware (auth, logging, cost-context)

## Endpoint Patterns
- All endpoints use Zod-validated input via @hono/zod-validator
- All responses follow { ok: true, data } | { ok: false, error } shape
- Auth via magic-link middleware (Resend), NOT JWT for MVP
- Long-running operations: queue a BullMQ job, return job_id, client polls or subscribes via WebPush

## Worker Patterns
- One worker per queue, queue name = step name (e.g. "draft-generation")
- Steps must be idempotent (re-runnable safely)
- Always wrap external calls in cost-tracker decorator
- Always log structured (pino, JSON output)

## Common Mistakes
- DO NOT do business logic in route handlers (that goes in /packages/core)
- DO NOT call adapters directly from routes (always via core services)
- DO NOT use process.env directly — use typed config from /packages/shared
```

Beispiel `apps/web/CLAUDE.md`:
```markdown
# Web App (Quasar PWA) Conventions

## Mobile-First Hard Rule
Every screen MUST be designed and tested at 375px width first.
Desktop is enhancement, NOT primary target.
Use Quasar's `q-page-container` with responsive padding.

## PWA Requirements
- Service Worker registered via Quasar PWA mode
- Web Push via VAPID keys (stored in .env)
- Offline shell for /inbox screen (cached articles list)
- Add-to-Homescreen prompt after 3rd visit

## Component Patterns
- Options API ONLY (matches Marcel's Vanilla v3 style)
- data: () => ({...}) shorthand
- Composables in /src/composables for shared logic
- Inputs from /src/components/inputs follow Vanilla v3 input patterns (enableAutocomplete prop)

## Screen Inventory (MVP)
1. /login         — Magic link request
2. /inbox         — Approval queue (articles + social posts)
3. /article/:id   — Article review with diff/inline comments
4. /post/:id      — Social post review
5. /projects      — Project switcher
6. /costs         — Cost dashboard

## Common Mistakes
- DO NOT use Vue Composition API
- DO NOT use Quasar v1 patterns (we're on v2)
- DO NOT design desktop-first then "make responsive"
- DO NOT use localStorage for auth — use httpOnly cookies set by API
```

---

## Teil C: Custom Commands

Lege diese in `.claude/commands/` an. Jede Datei wird zum Slash-Command.

### C.1 `/init-project` — Initial Bootstrap (1x verwenden)

`.claude/commands/init-project.md`:
```markdown
---
description: Bootstrap the marketing-automation monorepo from scratch
allowed-tools: Bash(bun:*), Bash(mkdir:*), Bash(git:*), Write, Edit
---

Bootstrap the marketing-automation monorepo following these exact steps:

1. Create the workspace structure:
   ```
apps/
api/         (Bun + Hono backend)
web/         (Quasar 2 PWA)
packages/
db/          (Drizzle schemas + migrations)
core/        (Domain logic)
pipelines/   (Pipeline templates)
adapters/    (External API clients)
cost-tracker/
prompts/
shared/      (Types, utils)
skills/      (already exists as git submodule)
   ```

2. Set up root package.json with Bun workspaces

3. Create docker-compose.yml with:
   - PostgreSQL 16 with pgvector extension
   - Redis 7
   - Both with persistent volumes

4. Initialize each app/package with minimal package.json

5. Set up TypeScript config:
   - Root tsconfig.base.json (strict, ESNext, bundler resolution)
   - Each package extends base
   
6. Add .gitignore (node_modules, .env, dist, .quasar)

7. Add .env.example with all required env vars listed

8. Create initial CLAUDE.md files in apps/api/, apps/web/, packages/pipelines/, packages/adapters/, packages/db/ — copy templates from /specs/00-foundation.md

After completion, run /review-task to verify everything is consistent.
```

### C.2 `/plan-spec` — Spec-Erstellung mit Plan-Mode

`.claude/commands/plan-spec.md`:
```markdown
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
```

### C.3 `/start-task` — Task-Beginn mit fresh context

`.claude/commands/start-task.md`:
```markdown
---
description: Start working on a specific task from a spec
allowed-tools: Read, Bash(git:*)
---

We're starting task: $ARGUMENTS

Steps:
1. Read /CLAUDE.md (root project context)
2. Read the relevant spec file from /specs/
3. Read the CLAUDE.md in the deepest relevant subdirectory
4. Read the relevant SKILL.md from /packages/skills/skills/ if applicable
5. Confirm understanding by stating in one paragraph:
   - What we're building
   - Which files will be touched
   - Which patterns/skills we're following
   - Any open questions or assumptions

Wait for Marcel's confirmation before starting implementation.
```

### C.4 `/review-task` — Standards-Check vor Commit

`.claude/commands/review-task.md`:
```markdown
---
description: Review changes against project standards
allowed-tools: Bash(git diff:*), Bash(git status:*), Read, Grep
---

Review all uncommitted changes (git diff + new files) against project standards:

**Universal Checks:**
- [ ] All TypeScript is strict (no `any`, no `as` casts without justification comment)
- [ ] No hardcoded strings that should be config (use /packages/shared/config)
- [ ] All comments and JSDoc are in English
- [ ] No console.log left behind (use pino logger)
- [ ] No commented-out code blocks
- [ ] All external API calls go through cost-tracker
- [ ] All boundary inputs (HTTP, queue jobs) validated with Zod

**Backend-specific (if apps/api/ touched):**
- [ ] Routes are thin glue, business logic in /packages/core
- [ ] Workers are idempotent
- [ ] Adapters are not called from routes directly
- [ ] No process.env direct usage outside /packages/shared/config

**Frontend-specific (if apps/web/ touched):**
- [ ] Vue Options API used (NO script setup, NO Composition API)
- [ ] data: () => ({...}) shorthand
- [ ] Mobile tested at 375px first
- [ ] Quasar v2 components only
- [ ] No localStorage for auth
- [ ] All user-facing strings via $t()

**Pipeline-specific (if packages/pipelines/ touched):**
- [ ] Steps follow BaseStep contract
- [ ] Steps are idempotent (re-running gives same result)
- [ ] Skills loaded from /packages/skills/, not redefined
- [ ] Project context loaded into prompt

**Database-specific (if packages/db/ touched):**
- [ ] All tables have project_id FK (multi-tenant)
- [ ] Migrations are reversible
- [ ] Indexes on FK columns and frequent query columns
- [ ] No CASCADE deletes without justification

Report violations with file + line number. Fix automatically where unambiguous; ask Marcel where decision needed.
```

### C.5 `/update-docs` — Doku-Maintenance nach Task

`.claude/commands/update-docs.md`:
```markdown
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
```

### C.6 `/catchup` — Session-Wechsel-Helper

`.claude/commands/catchup.md`:
```markdown
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
```
🌿 Branch: <name>
📝 Recent: <commits summary>
🚧 In progress: <files>
📋 Active spec: <path>
➡️  Next: <recommended action>
```
```

### C.7 `/cost-check` — Estimate vor expensiven Operationen

`.claude/commands/cost-check.md`:
```markdown
---
description: Estimate the LLM cost of the planned operation before executing
---

Before running the next code generation or pipeline test, estimate:

1. Which model(s) will be called?
2. Approximate input tokens (count files/text being passed)
3. Approximate output tokens (typical response size)
4. Cost in EUR using current rates:
   - Claude Haiku 4.5: $1/$5 per MTok
   - Claude Sonnet 4.6: $3/$15 per MTok
   - Claude Opus 4.7: $5/$25 per MTok
   - Cache reads: 90% discount on input
5. If cost > 0.50 EUR for a single operation, suggest cheaper alternatives

Report and ask for confirmation.
```

---

## Teil D: Sub-Agents (für parallelisierbare Spezialaufgaben)

In `.claude/agents/` definierst du fokussierte Sub-Agents. Diese laufen in eigenem Context-Window – der Haupt-Agent bleibt sauber.

### D.1 `code-reviewer.md`
```markdown
---
name: code-reviewer
description: Senior code reviewer focused on the marketing-automation project standards
tools: Read, Grep, Glob, Bash
model: haiku
---

You are a senior code reviewer for the marketing-automation project.
Your job is to review code changes against the standards in /CLAUDE.md and subtree CLAUDE.md files.

Focus on:
- Correctness and edge cases
- Adherence to project conventions (Hexagonal Architecture, Options API for Vue, etc.)
- Performance hot-spots (N+1 queries, sync IO in workers)
- Security issues (unvalidated inputs, secret leakage, prompt injection)
- Test coverage gaps

Output: a structured review report with severity tags (BLOCKER/MAJOR/MINOR/NIT) and file:line references.
```

### D.2 `prompt-engineer.md`
```markdown
---
name: prompt-engineer
description: LLM prompt engineering specialist for pipeline steps
tools: Read, Edit, Glob
model: sonnet
---

You are an LLM prompt engineer specialized in marketing content generation.

Your job is to design and tune system prompts for pipeline steps. You:
- Reference /packages/skills/skills/<skill>/SKILL.md as authoritative
- Combine skill content + project context (.agents/product-marketing-context.md) + step-specific instructions
- Optimize for prompt-caching (stable prefix, variable suffix)
- Choose appropriate model (Haiku/Sonnet/Opus) based on task complexity
- Document expected token usage and cost per call
```

### D.3 `db-migration-specialist.md`
```markdown
---
name: db-migration-specialist
description: Drizzle migration and PostgreSQL schema specialist
tools: Read, Edit, Bash(drizzle-kit:*)
model: sonnet
---

You design and write Drizzle schemas + migrations for the marketing-automation project.

Standards:
- Every table has `id` (uuid), `project_id` (FK), `created_at`, `updated_at`
- Indexes on all FKs and frequently queried columns
- JSONB for flexible config, separate columns for query-relevant fields
- Migrations are reversible (every up() has matching down())
- pgvector for embeddings (project_embeddings table for internal-linking)

Always run `bun drizzle-kit check` after writing a migration to verify SQL.
```

### D.4 `qa-tester.md`
```markdown
---
name: qa-tester
description: Writes Bun test specs for backend, Vitest for frontend
tools: Read, Edit, Write, Bash(bun test:*), Bash(bun run test:*)
model: sonnet
---

You write tests focused on:
- Pipeline steps (idempotency, error paths, cost logging)
- Adapters (mocked external APIs, retry logic)
- Routes (Zod validation, auth, error responses)
- Vue components (mount + interaction tests with Vitest)

Aim for high-value tests (one good test per critical path) over coverage padding.
```

---

## Teil E: Spec-Inventar (was du als nächstes baust)

Diese Specs erstellst du nacheinander mit `/plan-spec <name>`. Nach Approval implementierst du sie in fresh sessions.

### Phase 1 (Woche 1) — Foundation

- `/specs/00-foundation.md` — Repo-Setup, Workspaces, Docker, ENV, Logger, Config
- `/specs/01-database-schema.md` — Drizzle-Schemas für alle Kern-Entitäten
- `/specs/02-credential-vault.md` — Verschlüsselte Per-Tenant-API-Credentials
- `/specs/03-cost-tracker.md` — Cost-Logging + Hard-Limits + Kill-Switch
- `/specs/04-magic-link-auth.md` — Resend-basierte Auth für Web-App
- `/specs/05-base-pipeline-engine.md` — BaseStep, Pipeline-Klasse, BullMQ-Integration

### Phase 2 (Woche 2) — Cold-Start für KI-Wissensraum

- `/specs/10-project-marketing-context-skill-integration.md` — Wie wir den `product-marketing-context`-Skill für Tenant-Onboarding nutzen
- `/specs/11-anthropic-adapter.md` — Claude API Client mit Caching, Batching, Cost-Hooks
- `/specs/12-replicate-adapter.md` — Flux 1.1 Pro + Schnell für Hero/Social Images
- `/specs/13-dataforseo-adapter.md` — SERP, Keywords, Wettbewerber
- `/specs/14-cold-start-pipeline.md` — Identity-Workshop-Pipeline (ersetzt Telegram-Workshop)

### Phase 3 (Woche 3) — Article-Pipeline + Astro-Adapter + Web-UI Foundation

- `/specs/20-article-pipeline.md` — Brief → Outline → Draft → Faktencheck → Hero → Internal-Links → SEO-QA
- `/specs/21-astro-cms-adapter.md` — Git-Push in Astro-Repo, Content-Collection-Format
- `/specs/22-page-speed-integration.md` — Post-Publish PSI-Check mit Auto-Tickets
- `/specs/30-web-app-shell.md` — Quasar-PWA-Skeleton mit Routing, Service Worker, Layout
- `/specs/31-web-app-auth.md` — Magic-Link-Login-UI
- `/specs/32-web-app-inbox.md` — Approval-Queue-Screen mit Mobile-First-Layout

### Phase 4 (Woche 4) — Approval-Flow + Foundation-Content + Go-Live

- `/specs/40-article-review-screen.md` — Markdown-Preview, Diff-View, Inline-Comments, Approve/Reject/Request-Changes
- `/specs/41-web-push-notifications.md` — VAPID-Setup + Subscribe-Flow + Push-Sender
- `/specs/42-foundation-content-generator.md` — Batch-Produktion aus Cluster-Plan
- `/specs/43-social-repurpose-pipeline.md` — Carousel + Reel-Script aus Artikel
- `/specs/44-cost-dashboard.md` — Per-Project-View mit Heute/Woche/Monat
- `/specs/45-go-live-checklist.md` — Final-Checks vor Domain-Live-Schaltung

---

## Teil F: Dein konkreter Tag-für-Tag-Workflow

### Tag 1 (Setup-Tag)

**Morgens (90 Min):**
1. Dieses Dokument durchlesen
2. Repo wie in A.2 anlegen
3. Marketing-Skills-Submodul hinzufügen
4. Claude Code starten: `claude` im Repo-Root
5. `/init` ausführen (Claude scannt Repo, legt initiale CLAUDE.md an)
6. Root-`CLAUDE.md` mit dem Inhalt aus B.1 ersetzen
7. Custom Commands aus Teil C anlegen (alle 7 Files in `.claude/commands/`)
8. Sub-Agents aus Teil D anlegen (alle 4 Files in `.claude/agents/`)
9. Commit: `git commit -m "chore: claude code workspace setup"`

**Nachmittag (Rest des Tages):**
10. Neue Session: `claude` (frisch starten)
11. `/plan-spec Foundation Setup` — Claude erstellt `/specs/00-foundation.md`
12. Du reviewst die Spec sehr genau, gibst Feedback, iteriertst
13. Approval, dann `git commit -m "spec: foundation setup"`
14. Neue Session, `/start-task /specs/00-foundation.md`
15. Plan-Mode aktivieren (Shift+Tab 2x)
16. Claude plant Implementation, du approvest
17. Auto-Accept einschalten, Claude implementiert
18. `/review-task`, dann `/update-docs`, dann commit

**Abends:**
19. Stop. Eine Session pro Tag in der Foundation-Phase reicht. Qualität > Speed.

### Tag 2-7 (Phase 1 fortsetzen)

Pro Tag: 1-2 Specs erstellen + 1-2 Specs implementieren. Immer:
- Fresh session pro Spec-Implementation
- `/start-task` zum Onboarding
- Plan-Mode für nicht-triviales
- `/review-task` + `/update-docs` + commit am Ende

**Wichtig**: Du wirst feststellen, dass manche Specs überlappen oder Reihenfolge geändert werden sollte. Das ist normal. Wenn ja, anpassen, neue Spec schreiben mit `/plan-spec`.

### Tag 8-14 (Phase 2)

In dieser Phase passiert eine Besonderheit: **Du selbst bist Pilot-Tenant** (KI-Wissensraum). Tag 12-14 läufst du den Cold-Start-Workflow für dein eigenes Projekt durch. Das ist gleichzeitig **End-to-End-Test** und **Real-World-Setup**.

### Tag 15-21 (Phase 3)

Hier kommt die Quasar-PWA dazu. Da du Quasar bereits sehr gut kennst, geht das schnell. Achte besonders auf:
- Mobile-First (375px-Viewport in DevTools)
- Service Worker funktioniert offline für Inbox
- Web Push einrichten + Subscribe-Flow testen

### Tag 22-28 (Phase 4)

Foundation-Content für KI-Wissensraum produzieren. Hier reviewst du **viele Artikel hintereinander**. Die Approval-UI muss richtig gut sein. Falls du Schwächen entdeckst: Spec für UI-Verbesserung schreiben, implementieren, zurück zum Review.

**Tag 28 = Go-Live von KI-Wissensraum.**

---

## Teil G: Was schiefgehen wird (und wie du reagierst)

**Problem 1: Claude Code generiert Code im falschen Stil (z.B. Composition API).**
→ Lösung: `/review-task` fängt das ab. Wenn nicht: Stelle in der Root-`CLAUDE.md` "Common Mistakes" konkreter dar. Pattern in den subtree CLAUDE.md verstärken.

**Problem 2: Session degeneriert (Claude vergisst Spec, gibt schlechten Code).**
→ Lösung: Sofort `/clear`, neue Session, `/catchup` für State-Recovery, `/start-task` mit Spec-Referenz.

**Problem 3: Spec ist zu groß für eine Session.**
→ Lösung: `/plan-spec` aufrufen mit Anweisung "split this into smaller specs". Claude erstellt Sub-Specs, jeden in eigener Session implementieren.

**Problem 4: Marketing-Skills-Submodul muss customisiert werden.**
→ Lösung: Fork das Repo unter deinem GitHub-Account. Submodul-URL ändern. Custom-Skills im Fork hinzufügen. Pull-Requests für allgemein-nützliche Verbesserungen ans Original-Repo.

**Problem 5: Cost-Spike beim Testen.**
→ Lösung: Hard-Limits aus `/specs/03-cost-tracker.md` müssen früh konfiguriert sein. Notfall: Anthropic-Dashboard hat hard-cap pro API-Key.

**Problem 6: Die 4-Wochen-Deadline rutscht.**
→ Lösung: Scope-Cut, NICHT Quality-Cut. Was streichen ohne Live-Schaltung zu blockieren?
- Cost-Dashboard kann in Woche 5 nachgereicht werden
- Social-Repurposing kann in Woche 5 nachgereicht werden
- Page-Speed-Auto-Check kann manuell ersetzt werden
- Was NICHT streichen: Auth, Approval-UI, Cost-Tracker (Hard-Limits!), Article-Pipeline, Astro-Adapter

---

## Teil H: Drei Rituale, die du nicht überspringst

**Ritual 1: Daily Commit-Hygiene.**
Am Ende jedes Tages: alle WIP-Sachen committed (auch wenn unfertig, in einem `wip/`-Branch). Nichts liegt nur in deinem Editor.

**Ritual 2: Wöchentlicher Spec-Review.**
Sonntag-Abend (15 Min): Alle Specs in `/specs/` durchgehen. Was ist veraltet? Was ist deviated? Welche neuen Specs brauchen wir? Aktualisieren.

**Ritual 3: CLAUDE.md-Pflege.**
Nach jedem `/update-docs`-Lauf: 30 Sekunden den Diff der CLAUDE.md prüfen. Macht das Sinn? Ist das prägnant genug? Notfalls von Hand glätten.

---

## Teil I: Erster Prompt für Claude Code (kopierbar)

Wenn du die erste Claude-Code-Session startest, gibst du genau das hier ein:

```
Hi, ich starte ein neues Projekt: Multi-tenant Marketing Automation Platform.
Stack: Bun + Hono + Drizzle + Postgres + Redis + BullMQ (Backend), 
Quasar 2 PWA mit Web Push (Frontend, mobile-first).

Ich habe ein Master-Dokument vorbereitet, das die komplette Bauanleitung beschreibt.
Das Dokument liegt unter: ./claude-code-bauanleitung.md
(Hier: pfad einfügen oder Inhalt direkt einfügen)

Bitte:
1. Lies das komplette Dokument durch.
2. Bestätige in einem kurzen Absatz dein Verständnis: 
   - Was bauen wir?
   - Wie ist die Methodik?
   - Was ist der allererste Task?
3. Schlage vor, mit welchem Command wir starten.

Danach gehen wir gemeinsam Schritt für Schritt durch.
```

---

## Schluss: Was dieses Dokument NICHT ist

Dies ist **keine** Code-Vorlage und **kein** vollständiges Spec. Es ist eine **Methodik-Anleitung**, mit der du Claude Code so lenkst, dass die Plattform in 4 Wochen entsteht. Jede tatsächliche Implementierungsentscheidung trifft Claude Code mit dir gemeinsam in den Plan-Mode-Sessions.

Die 4-Wochen-Deadline ist ambitioniert aber realistisch, weil:
- Die Marketing Skills decken ~80% der Marketing-Domain-Knowledge ab (du musst sie nicht erfinden)
- Du kennst Quasar/Vue Options API bereits exzellent (Frontend = bekanntes Terrain)
- Hexagonal Architecture ist dir vertraut (Backend-Design = bekanntes Terrain)
- Bun+Hono+Drizzle ist 2026 ein durchgekautes Stack (keine Forschung nötig)
- Claude Code mit Plan-Mode + Custom Commands + Sub-Agents ist der State-of-the-Art für dieses Volumen

Der einzige echte Risikofaktor: **disziplinierte Session-Hygiene**. Du wirst versucht sein, in einer Session zu lange zu bleiben. Tu es nicht. Eine Session pro Task. `/clear` ist dein Freund.

Viel Erfolg.
