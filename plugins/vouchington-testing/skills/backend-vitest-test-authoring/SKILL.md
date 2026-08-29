---
name: backend-vitest-test-authoring
description: Apply backend Vitest patterns for service, provider, persistence, and queue boundaries.
---

# Backend Vitest test authoring

Apply [vitest-test-authoring](../vitest-test-authoring/SKILL.md) first. Exercise real integration
boundaries only when their lifecycle is controlled by the test environment; otherwise mock the
network or provider edge. Randomize fixture identities where shared stores can collide, assert
authorization and retry behavior at boundaries, and clean up resources deterministically.

Consumer wrappers own database setup, queue providers, test projects, and rate-limit policy.
