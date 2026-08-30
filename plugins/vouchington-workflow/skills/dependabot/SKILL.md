---
name: dependabot
description: Configure or audit Dependabot coverage, cooldowns, package-family grouping, trusted CI, and conservative auto-merge policy for a repository.
---

# Dependabot policy

Read every applicable `AGENTS.md` and `CLAUDE.md`, then the repository's dependency, CI, release,
and branch-protection documentation. The consumer wrapper owns the accepted cooldown, package roots,
first-party publishers, manual-update exceptions, runner policy, required checks, and secret source.

## Cover the dependency graph

1. Inventory tracked manifests, lockfiles, Dockerfiles, workflow actions, infrastructure roots, and
   any companion dependency bot. Add one Dependabot update entry for every supported ecosystem and
   manifest root, without creating competing ownership for a dependency already assigned elsewhere.
2. Schedule version checks daily. Set `cooldown.default-days` to the consumer's release delay; use
   seven days unless local policy explicitly chooses another value. Cooldown applies to version
   updates, not security updates.
3. Set `open-pull-requests-limit: 5` on every update entry. This is a per-entry version-update
   limit, not a repository-wide or security-update limit. A consumer may use a lower value when a
   serialized repair or manual validation path requires it.
4. Keep security updates enabled and immediate. Do not use a custom age gate to delay vulnerability
   fixes.

## Group package families

Build groups around packages that form one compatibility family or release train, not around version
types. Inspect manifests, peer dependencies, lockfiles, and upstream release practices to identify
packages that should move together. For example:

```yaml
groups:
  oxc:
    patterns: ['oxlint', 'oxfmt', 'oxlint-tsgolint']
  vitest:
    patterns: ['vitest', '@vitest/*', '@vitejs/*']
  react:
    patterns: ['react', 'react-dom']
  react-email:
    patterns: ['react-email', '@react-email/*']
```

- Name each group after the package, toolchain, framework, or verified release family it represents.
  Prefer narrow namespace or prefix wildcards such as `@vitest/*` when that wildcard maps to one
  compatibility family, and put more specific families before broader ones.
- Do not create generic `minor-and-patch`, `security-updates`, or other version-based buckets. Do not
  use the bare catch-all `patterns: ['*']` merely to ensure every update belongs to a group. Narrow
  family wildcards are expected. Leave unrelated packages ungrouped so Dependabot opens independently
  reviewable pull requests for them.
- Use `update-types` only as an optional eligibility filter inside a package-family group, such as
  keeping that family's major updates independent. The version type must not be the reason otherwise
  unrelated dependencies share a pull request.
- Group security updates only when the same package-family relationship makes a joint upgrade safe;
  never combine unrelated vulnerability fixes into a generic security group.
- Group first-party packages together only when they share an owning release train and are expected
  to be consumed atomically. A grouped pull request is auto-mergeable only when every included update
  is eligible.

## Exempt verified first-party releases

Use `cooldown.exclude` only for first-party packages whose owning repository and default-branch
release workflow have been verified. The workflow must publish that package through OIDC with
`id-token: write` and without a long-lived registry token. Prefer exact package names; do not exempt
an author or namespace merely because it is usually first-party. Keep the consumer-owned registry,
documentation, cooldown exclusions, and first-party group synchronized.

## Preserve the trust boundary

Use a trusted default-branch `pull_request_target` workflow only for metadata inspection and the
minimal auto-merge mutation. Revalidate the live pull request, Dependabot identity, default base,
same-repository `dependabot/` head, and immutable base/head SHAs. Never check out or execute pull
request code in that privileged workflow, and pin external actions according to local policy.

Auto-merge only verified semantic-version patches and stable minor updates whose old and new major
versions are at least 1. Majors, pre-1.0 minors, prereleases, downgrades, malformed or inconsistent
metadata, and consumer-declared manual ecosystems require human action. Enable platform auto-merge;
do not auto-approve. Required checks and branch rules remain the merge gate.

Use a dedicated `DEPENDABOT_AUTOMERGE_TOKEN` stored as a Dependabot secret, not only as an Actions
secret. Grant only the repository Contents and Pull requests access needed to enable or disable
auto-merge, and fail an eligible mutation visibly when the token is absent or underprivileged.

Dependabot-triggered workflows cannot assume ordinary Actions secrets or trusted OIDC access. Copy
only narrowly scoped credentials required for mandatory tests into Dependabot secret scope. For
cloud, deployment, production, or otherwise privileged checks, keep credential-free validation
running and make the trusted portion explicitly skipped or not applicable for Dependabot. Required
fan-in jobs must distinguish that intentional state from an unexpected missing credential.

## Validate and roll out

Parse the final YAML, run the repository's workflow checker and policy tests, and inspect the diff
for uncovered manifests, overlapping groups, broad exemptions, secret exposure, or pull request code
crossing a privileged boundary. Verify repository settings for dependency security updates and
auto-merge. After the configuration reaches the default branch, inspect Dependabot logs for every
configured root and verify representative patch, minor, major, security, manual, and missing-secret
paths.
