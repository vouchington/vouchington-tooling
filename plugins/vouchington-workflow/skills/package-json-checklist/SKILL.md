---
name: package-json-checklist
description: Use when changing JavaScript package metadata, dependencies, scripts, workspaces, or published entrypoints.
---

# Package metadata checklist

Use before changing `package.json`, a lockfile, workspace metadata, or a package entrypoint. Read
every applicable `AGENTS.md` and `CLAUDE.md` from the repository root through the owning package,
applying the closest file only when rules conflict. Those instructions own package-manager version,
dependency age/version policy, registry, release process, and package layout.

1. Identify the owning package and every consumer of the changed script, dependency, export, or
   binary. Prefer existing workspace utilities before adding a dependency.
2. Use the repository's package manager for dependency changes. Update the lockfile when it records
   the affected metadata; avoid lockfile churn for metadata-only edits it does not record. Keep peer,
   optional, development, and runtime dependencies in their intended sections.
3. For a published package, verify exports, types, files, binaries, and build output match the
   package's supported import and installation paths.
4. Run the package manager's integrity check, focused tests, typecheck, build, and local policy
   checks required by the affected package. Do not publish or alter registry state without explicit
   authorization.
5. Review the lockfile and generated metadata for unrelated churn before committing.

This skill supplies no version range, workspace topology, registry, package-manager command, or
release convention. Put those repository-specific choices in local instructions or a wrapper.
