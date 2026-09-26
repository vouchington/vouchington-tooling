---
name: backend-vitest-test-authoring
description: Apply backend Vitest patterns for service, provider, persistence, and queue boundaries.
---

# Backend Vitest test authoring

Apply [vitest-test-authoring](../vitest-test-authoring/SKILL.md) first.

- Exercise a real integration boundary only when the test environment controls its lifecycle.
  Otherwise mock the network or provider edge.
- Randomize fixture identities where a shared store can collide.
- Assert authorization and retry behavior at the boundary.
- Clean up resources deterministically.
- Read [integration boundaries](references/integration-boundaries.md) for fixture and collision
  safety.

Consumer wrapper owns: database setup, queue providers, test projects, and rate-limit policy.
