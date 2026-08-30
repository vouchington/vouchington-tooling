---
name: npm-publishing
description: Bootstrap an npm package and give a human the exact commands to publish it publicly and configure GitHub trusted publishing.
---

# npm publishing bootstrap

Prepare the local package, but leave public registry and trusted-publisher mutations to the human.
Read every applicable `AGENTS.md` and `CLAUDE.md` from the repository root through the package.
Repository-local policy and the consumer wrapper own the package path and name, npm scope, GitHub
repository, release workflow, build commands, and whether a laptop may publish.

## Prepare the package

1. Resolve the absolute repository root, package directory relative to that root, exact npm package
   name, `owner/repository`, and release workflow filename. The workflow value is the case-sensitive
   filename under `.github/workflows`, not a path. Do not leave placeholders in the final commands.
2. Confirm npm 11.15 or newer, account-level two-factor authentication, and write access to the npm
   package or scope. Inspect the workflow on the repository's default branch: it must grant
   `id-token: write`, use a supported runner, install a trusted-publishing-capable npm version, and
   publish this package.
3. When the package does not exist in the registry, create the smallest useful stub module in its
   intended directory. Follow neighboring package conventions for metadata, source, exports, types,
   license, README, build output, and workspace registration. Do not replace an existing module with
   a stub or publish a version already present in the registry.
4. Build the package as required, then inspect the publication lifecycle and exact payload with
   `npm publish <package-directory> --access public --dry-run`. Stop if it includes secrets,
   environment files, source maps, unrelated workspace files, or missing runtime/type entrypoints.
   This dry run must include `prepublishOnly`; a pack-only check is insufficient when that lifecycle
   script can change the payload.
5. If the package already exists, have the human run `npm trust list <package-name>` before any
   mutation. Omit the initial publish command. If a trust relationship already exists, report it and
   omit the trust-creation command rather than revoking or replacing it.

## Hand off the mutations

Do not run a real `npm publish` or a mutating `npm trust` subcommand. Explain that the first command
creates an externally visible, effectively irreversible package version and the second grants the
named workflow publish authority. Include the publish command only when bootstrapping a package that
does not exist; an existing package proceeds directly to trust setup when its trust list is empty.
Tell the human to append a current one-time password after each final `--otp=` without sharing or
recording it. Warn that the requested `--otp=` form can expose the OTP in shell history and process
arguments, and tell the human to follow their local secret-handling policy. Give the applicable
commands with fully resolved values and in this order:

```sh
cd /absolute/repository/root
npm publish ./relative/package-directory --access public --otp=
npm trust github @scope/package \
  --repo owner/repository \
  --file release.yml \
  --allow-publish \
  --yes \
  --otp=
```

The `cd` target must be the directory from which the relative publish path resolves. If local policy
prohibits publishing from the current machine, say so and identify the approved environment while
preserving the same ordered commands. Ask the human to confirm the package payload, package name,
repository, workflow filename, and publish permission immediately before running them.

Afterward, have the human verify any newly published package version and run
`npm trust list @scope/package` again. Do not retry authorization or registry failures blindly, and do
not fall back to a long-lived npm token without explicit direction.
