# Finite enum ripple

`vouchington-tooling/finite-enum-ripple` exports `checkFiniteEnumRipple(ctx, config): string[]` and the `FiniteEnumRippleConfig` and `FiniteEnumFiles` types. It compares two optional families of finite TypeScript declarations with route configuration and selected page files. The `topic` family compares structured values with singular and plural slugs. The `post` family compares a string union, slug map, collection routes, create pages, and detail factory calls. Either family may be omitted.

The caller classifies existing tracked files into `config.files`, including whether a routed page is top level. It supplies declaration names, source paths, property names, factory call and route-literal patterns, exclusions, route labels, and policy exceptions in `config.topic` and `config.post`. Component files carry their route slug alongside their path. The package does not scan consumer directories or invent default exceptions. `ctx.readTrackedFile` is used when present; otherwise the checker reads from `ctx.repoRoot`.

Route-literal patterns must have the `g` flag and capture the path without its leading slash in group 1.

The checker returns GitHub annotation strings for semantic mismatches. A missing required declaration file skips that family's comparison, as in the original guard. Invalid present declarations throw a descriptive parse error with the configured file and declaration name. Consumer adapters can append the returned diagnostics to their own policy result and set `diagnosticSuffix` to add a local checklist link or other guidance.

Install `@typescript/typescript6` when importing this subpath. It uses the classic TypeScript compiler API; the root `typescript@7` package does not expose that API.
