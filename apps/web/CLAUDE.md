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
- Composables in /src/composables for shared logic
- Inputs from /src/components/inputs

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
