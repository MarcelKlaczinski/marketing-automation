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
