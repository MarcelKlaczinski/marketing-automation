# F2 — Pipeline-Observability bei `astro:repo-import`

**Datum:** 2026-05-24
**Spec:** [`specs/004-mini-cleanup.md`](../../specs/004-mini-cleanup.md) Sprint F2
**Outcome:** Decision **D** — Status-Quo + Doku. Kein Code-Change.

---

## Beobachtung (spec-side)

Pro Re-Import-Trigger werden 11 `pipeline_runs` geloggt. Spec-Verfasser
vermutete: "Nur 1 davon (93s) hat substantiell gearbeitet, 10 sind
No-Op-Runs (0-16s)" mit BullMQ-Dedup als hypothetische Ursache.

## Tatsächlicher Befund

Die 11 Rows sind kein Bug. Es ist das Standard-Pattern des Pipeline-Runners:

- **1 Parent-Row** (`parent_run_id IS NULL`, `step_name IS NULL`) — repräsentiert
  den gesamten Pipeline-Lauf. INSERT in [runner.ts:202](../../packages/pipelines/src/engine/runner.ts:202).
- **N Child-Rows** (`parent_run_id = parent.id`, `step_name = '<step>'`) — eine
  pro Pipeline-Step. INSERT in [runner.ts:438-449](../../packages/pipelines/src/engine/runner.ts:438).

`RepoImportPipeline` ([pipeline.ts](../../packages/adapters/astro-sync/src/import/pipeline.ts))
hat 10 Steps:

1. `extract-collection-schemas`
2. `list-content-files`
3. `filter-changed-files`
4. `parse-frontmatter-batch`
5. `mirror-hero-images`
6. `upsert-articles`
7. `link-translation-pairs`
8. `sync-clusters-from-frontmatter`
9. `detect-content-gaps`
10. `update-import-run`

⇒ 1 + 10 = **11 `pipeline_runs` Rows pro Trigger**, exakt wie beobachtet.

### Verifikation cross-pipeline

| Pipeline             | Step-Count | Rows pro Trigger (DB-Messung) |
| -------------------- | ---------- | ----------------------------- |
| `astro:repo-import`  | 10         | 11                            |
| `article:blog`       | 13         | 14                            |
| `planning:weekly`    | 11         | 12                            |

Pattern bestätigt: `rows = 1 + step_count` für jede registrierte Pipeline.

### Sind die Child-Rows "No-Ops"?

Nein. Der Spec-Verfasser hat eine inkrementelle Re-Import-Run (19:10:55Z, 7s
total) gemessen, in der die meisten Steps tatsächlich wenig Arbeit hatten,
weil sich am Astro-Repo seit dem letzten Import kaum was geändert hatte.
Die voll-Import-Runs (z.B. 16:58Z, 76s total nach C2-Cleanup) zeigen:

| Step                     | Duration (s) |
| ------------------------ | ------------ |
| parse-frontmatter-batch  | 10           |
| mirror-hero-images       | 30           |
| upsert-articles          | 26           |
| sync-clusters-from-frontmatter | 1     |

Substantielle Arbeit, nichts no-op-mäßig.

## Wozu existieren die Child-Rows?

Jede Child-Row ist Audit-Substrate für:

1. **Per-Step Success/Failure Tracking** — `status='running' → 'completed' | 'failed'`
   pro Step, mit `error_message` bei Crash.
2. **Step-Pause Mechanik** (Spec 62.0a) — `step_pauses.step_run_id` FK zeigt auf
   die Child-Row. Ohne sie kein Pause-Pattern.
3. **Re-Run Mechanik** (Spec 62.6) — `supersedeOldSubstep(runId, stepName)`
   ([runner.ts:346/362/373](../../packages/pipelines/src/engine/runner.ts:346))
   markiert eine Child-Row als `status='superseded'`, damit Re-Run sie nicht doppelt
   abrechnet.
4. **Idempotency-Cache Attribution** — Cache-Hits bekommen ihren eigenen Child-Run
   mit `output` aus dem Cache.
5. **SSE-Events** — `step.paused`, `step.resolved`, `run.statusChanged`
   ([apps/api/CLAUDE.md "Pipeline-Runs Resolve + Rerun"](../../apps/api/CLAUDE.md))
   referenzieren die Child-Row für die UI.

## BullMQ-Dedup-Hypothese: widerlegt

`enqueueRepoImport` ([trigger.ts:41](../../packages/adapters/astro-sync/src/import/trigger.ts:41))
verwendet bereits deterministische `jobId: repo-import-${run.id}`. BullMQ
deduped Concurrent-Calls auf dieser ID. Spec §7 FU-2 vermutete: "C —
deterministische jobId" als Fix-Option — die ist bereits implementiert.

Wenn BullMQ tatsächlich dedupliziert hätte, wäre nur das ZWEITE
`enqueuePipeline` no-op, nicht 10 weitere Child-Rows pro Single-Trigger.

## Decision-Matrix (Spec §3.2 F2.2)

| # | Option                                               | Verdict |
| - | ---------------------------------------------------- | ------- |
| A | No-Op-Runs nicht loggen                              | Falsch — sind keine No-Ops. Wären sie es, würde das Schema-Pause + Rerun-Logik brechen. |
| B | No-Op-Runs als `kind='no-op'` taggen                 | Falsch — keine No-Ops. |
| C | Deterministische jobId                               | Bereits implementiert. |
| D | **Status-Quo behalten + Doku ergänzen**              | **Gewählt** — by-design. Doc-only Output. |

## Optional: UI-Verbesserung (out of scope)

Pipeline-Runs UI ([routes/pipeline-runs.ts](../../apps/api/src/routes/pipeline-runs.ts))
listet aktuell Parent + Children flach. Ein Mini-Refactor könnte Children
unter ihrem Parent collapsen (`parent_run_id IS NOT NULL` als sub-section).
Aber: das ist UI-Work, kein Pipeline-Engine-Change, und nicht in F2-Scope.
Falls jemals nötig: separater Spec unter "Priorität 3 (smaller items)" im
`docs/backlog/post-cleanup-followups.md`.

## Akzeptanz F2 nach Decision D

Spec §3.2 F2.4 + F2.5 (Smoke-Tests + Manual-Verify "1 statt 11" SQL) sind
**nicht anwendbar** — der Fix ist doc-only, es gibt nichts zu testen. Die
Akzeptanz-Liste F2 (Spec §3.2 Acceptance) wird in F4-IMPLEMENTED.md adjusted:

- F2.1 ✅ Code-Read-Output (dieses Dokument)
- F2.2 ✅ Marcel-Decision: **D**
- F2.3 ⊘ entfällt
- F2.4 ⊘ entfällt
- F2.5 ⊘ entfällt
- Backlog-Eintrag in `docs/backlog/post-cleanup-followups.md` schließen mit
  Referenz auf dieses Dokument
