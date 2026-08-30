---
name: static-analysis-checklist
description: Use when adding, changing, replacing, or removing static-analysis rules, configurations, fixtures, suppressions, allowlists, or repository guards.
---

# Static analysis checklist

Use when changing a static-analysis invariant. Read repository-local instructions, analyzer
documentation, rule inventory, and fixture conventions before selecting an implementation.

1. State the invariant and search for an existing analyzer, rule, or guard that owns it. Prefer the
   narrowest established owner over a parallel scanner.
2. Add positive and negative fixtures before the rule. Cover path routing, parser boundaries, and
   every allowed exception.
3. Keep discovery limited to tracked, intended files. Make suppressions and allowlists narrow,
   justified, and mechanically checked for freshness where practical.
4. Run the focused fixture test and analyzer, then the local aggregate checks. Keep diagnostics
   actionable and deterministic.
5. Update the local inventory or documentation and delete superseded migration artifacts only when
   the replacement invariant is demonstrably enforced.

This skill does not name analyzer roots, fixture locations, commands, suppression syntax, or
rollout policy. A consumer wrapper or local instruction file provides them.
