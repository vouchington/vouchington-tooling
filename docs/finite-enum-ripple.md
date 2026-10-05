# Finite enum ripple

`vouchington-tooling/finite-enum-ripple` exports `checkFiniteEnumRipple(ctx, config): string[]` and the `FiniteEnumRippleConfig` and `FiniteEnumFiles` types. It compares two optional families of finite TypeScript declarations with route configuration and selected page files. The `structured` family compares structured values with singular and plural slugs. The `union` family compares a string union, slug map, collection routes, create pages, and detail factory calls. Either family may be omitted.

The caller classifies existing tracked files into `config.files`, including whether a routed page is top level. It supplies declaration names, source paths, property names, factory call and route-literal patterns, exclusions, route labels, and policy exceptions in `config.structured` and `config.union`. Component files carry their route slug alongside their path. The package does not scan consumer directories or invent default exceptions. `ctx.readTrackedFile` is used when present; otherwise the checker reads from `ctx.repoRoot`.

The structured family expects a collection route for every declared value except those explicitly listed in `collectionRouteExclusions`. Keep that list to values whose collection route is intentionally absent.

Route-literal patterns capture the path without its leading slash in group 1. The checker adds the `g` flag to a copy of a pattern when needed, preserving its other flags.

The checker returns GitHub annotation strings for semantic mismatches. A missing required declaration file skips that family's comparison, as in the original guard. An invalid present declaration ends that family's comparison and returns a diagnostic naming the configured file and declaration; the other family still runs. Consumer adapters can append the returned diagnostics to their own policy result and set `diagnosticSuffix` to add a local checklist link or other guidance.

Install `@typescript/typescript6` when importing this subpath. It uses the classic TypeScript compiler API; the root `typescript@7` package does not expose that API.
