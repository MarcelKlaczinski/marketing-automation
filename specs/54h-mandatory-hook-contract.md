# Spec 54h — Mandatory Hook Contract

## Goal

Add `generateHook()` as a required field on every `TemplateDefinition`. Wire hook generation into
the render worker so hooks are validated and LLM-quality before the slide renders.

Move the pure hook utilities (hookEngine, hookValidator, hookPrompt, generateHookWithGate) from
`packages/pipelines` to `packages/core` so any package can import them without pulling in the
Anthropic adapter.

## Background

Before 54h, template hooks were assembled inline inside `render()` with hardcoded patterns and zero
validation. The `hookEngine`/`hookValidator` pipeline existed in `packages/pipelines` but templates
never used it. Every template bypassed word-count checks, forbidden-word gates, and retry logic.

## Implementation

### 1. `packages/core/src/social-hooks/`

Four pure TypeScript files (no adapters, no DB, no Remotion):

| File | Exports |
|------|---------|
| `hookEngine.ts` | `HookPattern`, `HookOutput`, `HookArticleContext`, `inferArticleType`, `selectPattern`, `buildPromiseBlock`, `programmaticFallbackHook` |
| `hookValidator.ts` | `validateHook`, `ValidationResult` |
| `hookPrompt.ts` | `buildHookPrompt`, `HOOK_SYSTEM_PROMPTS` |
| `generateHook.ts` | `HookLlmCaller`, `HookLogger`, `generateHookWithGate` |

Barrel: `packages/core/src/social-hooks/index.ts` re-exports all four.
Entry: `packages/core/src/index.ts` adds `export * from "./social-hooks/index.ts"`.
Package export: `"./social-hooks": "./src/social-hooks/index.ts"` in `packages/core/package.json`.

`packages/pipelines/src/article/social-image/steps.ts` updated to import from `@marketing-auto/core`
instead of local paths.

### 2. `TemplateDefinition` schema changes (`packages/social/src/templates/types.ts`)

```typescript
export type HookLlmCaller = (systemPrompt: string, userPrompt: string) => Promise<string | null>;

// Added to TemplateDefinition:
generateHook: (
  article: Article,
  input: TInput,
  locale: Locale,
  llmCaller: HookLlmCaller,
) => Promise<HookOutput>;

// Added to RenderContext:
hookOutput?: HookOutput;
```

`HookLlmCaller` is a dependency-injection callback. Templates stay free of `@marketing-auto/adapter-anthropic`.

### 3. All 4 templates updated

Each template implements `generateHook()` using the canonical pattern:

```typescript
import { generateHookWithGate, inferArticleType, selectPattern } from "@marketing-auto/core";

generateHook: async (article, input, _locale, llmCaller) => {
  const articleType = inferArticleType(article.title ?? article.slug, toolCount);
  const pattern = selectPattern(article.id, articleType);
  return generateHookWithGate(
    { id: article.id, title: article.title ?? article.slug, toolCount, toolNames },
    pattern,
    llmCaller,
  );
},
```

Templates' `render()` now reads `context.hookOutput ?? inlineFallbackHook` instead of assembling hooks from scratch.

### 4. `discoveryWorker.ts` wiring

```typescript
const { anthropic } = await import("@marketing-auto/adapter-anthropic");
const locale = render.locale as Locale;
const llmCaller: HookLlmCaller = async (systemPrompt, userPrompt) => {
  try {
    const resp = await anthropic.messages({
      projectId: article.projectId,
      operation: "SOCIAL_HOOK_GENERATION",
      model: "claude-haiku-4-5",
      systemPrefix: "",
      systemSuffix: systemPrompt,
      userMessage: userPrompt,
      maxTokens: 256,
      estimatedCostEur: 0.001,
      jsonMode: true,
    });
    return resp.raw;
  } catch {
    return null;
  }
};

const hookOutput = await template.generateHook(article, renderInput, locale, llmCaller);
const renderResult = await template.render({ ..., locale, hookOutput });
```

`pipelineRunId` is omitted — the adapter only accepts `string`, and there is no pipeline run in
this context. Passing `null` causes a TypeScript error.

## Acceptance Criteria

- [x] `packages/core` exports `generateHookWithGate`, `inferArticleType`, `selectPattern`, `programmaticFallbackHook` from `@marketing-auto/core`
- [x] `packages/pipelines/steps.ts` imports hook utilities from `@marketing-auto/core` (not local paths)
- [x] `TemplateDefinition.generateHook` is a required field (TypeScript enforces on all templates)
- [x] `RenderContext.hookOutput` carries the pre-generated hook to `render()`
- [x] All 4 templates implement `generateHook()` via `generateHookWithGate()`
- [x] `discoveryWorker.ts` calls `generateHook()` before `render()`, passes `llmCaller` from Anthropic adapter
- [x] `bun tsc --noEmit` on `apps/api` passes clean

## Discovered During Implementation

- **`article.title` is `string | null`** — `HookArticleContext.title` requires `string`. Must use `article.title ?? article.slug` everywhere. TypeScript doesn't catch this at the call site because the `??` fallback is required.
- **`pipelineRunId: null` rejected by adapter** — `anthropic.messages()` field is `string` only, not `string | null`. Omit the field when no pipeline run exists.
- **`HookOutput` structural compatibility** — two separate `HookOutput` definitions exist: interface in `core/hookEngine.ts` and Zod-inferred type in `social/list-carousel/types.ts`. TypeScript's structural typing makes them assignable without a shared import — no explicit alignment needed as long as both have identical shapes.
