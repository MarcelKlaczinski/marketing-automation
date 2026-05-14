# Spec 54g — Template Schema Formalization

**Type:** Schema + Bug Fix (additive, no behavior change)
**Estimate:** 2–3h, 1–2 commits
**Depends on:** Spec 54f (single-tool-spotlight complete)
**Goal:** Add first-class `outputFormat`, `compatibleChannels`, `generationClass`, and `plannerMeta` fields to `TemplateDefinition`. Fix two quick-wins: Instagram slide-count overflow bug (QW-1) and hardcoded brandToken strings (QW-2).

---

## Context

All four current templates treat their output format, target channels, and generation class as implicit — carousel is assumed, Instagram is assumed, frontmatter-derived is assumed, but none of this is declared in the schema. Spec 54h (hook contract), 54i (channel-aware captions), and 54j (render backend) all need these axes declared before they can build on top.

This spec makes them first-class without changing any behavior — purely additive TypeScript fields.

---

## Changes

### 1. New types in `packages/social/src/templates/types.ts`

```typescript
export type OutputFormat    = "carousel" | "reel" | "story";
export type Channel         = "instagram" | "tiktok" | "linkedin";
export type GenerationClass = "frontmatter-derived" | "llm-live";

export interface TemplatePlannerMeta {
  contentType: "comparison" | "tool-spotlight" | "use-case" | "news" | "concept";
  estimatedEngagementTier: "low" | "medium" | "high";
  recycleableFromExistingArticle: boolean;
  requiresLiveData: boolean;
}
```

### 2. New required fields on `TemplateDefinition`

```typescript
outputFormat: OutputFormat;
compatibleChannels: Channel[];
generationClass: GenerationClass;
plannerMeta: TemplatePlannerMeta;
```

All four fields are added as required — TypeScript enforces at build time that every template declares them.

### 3. All 4 templates updated

| Template | outputFormat | compatibleChannels | generationClass | contentType |
|----------|-------------|-------------------|-----------------|-------------|
| `comparison-stunning` | `"carousel"` | `["instagram", "tiktok"]` | `"frontmatter-derived"` | `"comparison"` |
| `comparison-stunning-3` | `"carousel"` | `["instagram", "tiktok"]` | `"frontmatter-derived"` | `"comparison"` |
| `use-case-verdict-per-tool` | `"carousel"` | `["instagram", "tiktok"]` | `"frontmatter-derived"` | `"use-case"` |
| `single-tool-spotlight` | `"carousel"` | `["instagram", "tiktok"]` | `"frontmatter-derived"` | `"tool-spotlight"` |

### 4. QW-1 — Fix UseCaseVerdictCarousel slide count bug

`useCaseVerdictPerTool.ts` line 54: `.slice(0, 8)` → `.slice(0, 7)`

1 (cover) + 7 (verdicts) + 2 (tally + recap) = 10 ≤ Instagram limit.
Current `.slice(0, 8)` allows 11 slides which exceeds Instagram's carousel maximum.

### 5. QW-2 — Wire brandTokens in useCaseVerdictPerTool

Add `DEFAULT_BRAND_TOKENS` fallback (same pattern as `comparisonStunning.ts`) and use `brandTokens.social.websiteUrl` / `brandTokens.social.instagramHandle` instead of hardcoded strings.

---

## Acceptance

- [ ] TypeScript builds clean with no errors (`tsc --noEmit`)
- [ ] All 4 templates declare all 4 new fields
- [ ] `use-case-verdict-per-tool` caps verdicts at 7, not 8
- [ ] `use-case-verdict-per-tool` uses `context.brandTokens ?? DEFAULT_BRAND_TOKENS`
- [ ] No existing render behavior changes — same slide output as before

---

## Out of Scope

- `buildCaption(channel)` / `buildHashtags(channel)` on the interface → Spec 54i
- `discoveryWorker.ts` gating on `generationClass` → Spec 54g runner update (after 54h)
- DB columns (`outputFormat`, `channel` on `social_posts`) → Spec 54k
