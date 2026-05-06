# Replicate Adapter

Image generation via Replicate. Outputs are downloaded and re-stored to R2 for stable URLs.

## Credential Loading (Spec 32)

The client prefers credentials from the global vault (`getGlobal("replicate", "api_token")`),
falling back to `REPLICATE_API_TOKEN` env var. Set via installer or env var for local dev.
Vault credential changes require an API server restart to take effect (cached singleton).

## Hard Rules

- ALL pipeline steps that need an image use this adapter — never `replicate` directly
- EVERY call requires `projectId`, `operation`, `estimatedCostEur`, and `storagePrefix`
- Generated URLs are R2-backed (stable). Replicate's URLs expire in 24h — never persist them.
- The `storagePrefix` should encode tenant + content-type (e.g. `ki-wissensraum/articles/hero`)
  so R2 stays browsable

## Model Routing

- `flux-1.1-pro`: hero images, anything article-quality, high prompt adherence
- `flux-schnell`: social variants, thumbnails, anything where speed/cost matter (~13× cheaper)
- `ideogram-v3`: anything with on-image text (quote cards, listicle covers)

When in doubt, use `flux-1.1-pro` for "important" images, `flux-schnell` for "supporting".

## Common Mistakes

- DO NOT pass `storagePrefix` starting or ending with `/` (the adapter strips them, but cleanly)
- DO NOT exceed quality 100 on flux-1.1-pro (no effect)
- DO NOT use `flux-schnell` for hero images — visible quality drop on close inspection
- DO NOT skip `seed` if you need reproducibility (e.g. regenerating the same hero after edits)
- DO NOT call this in a tight loop — each call is ~10-20s; budget time accordingly in pipelines
