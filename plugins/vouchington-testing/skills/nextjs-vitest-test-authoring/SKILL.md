---
name: nextjs-vitest-test-authoring
description: Apply Vitest patterns for Next.js components, routes, and server-side modules.
---

# Next.js Vitest test authoring

Apply [vitest-test-authoring](../vitest-test-authoring/SKILL.md) first. Mock framework navigation,
headers, and server-only boundaries at the framework edge, then test component behavior through
rendered output and user-visible state. Keep API-response fixtures representative and avoid testing
framework internals. Use browser tests for behavior that cannot be represented in the test runtime.

Consumer wrappers own framework mock helpers, render libraries, and route fixture conventions.

Read [framework boundaries](references/framework-boundaries.md) for module shape and server-only cases.
