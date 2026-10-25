---
'vouchington-tooling': minor
---

Add `--allow-registry <prefix>` (repeatable) and `--require-digest` to `vouchington docker-image-mirror`,
with matching `allowRegistries` and `requireDigest` options on `checkDockerImageMirrors`. With an
allowlist every image reference (workflow `container`/`services`, `docker://`, `docker` commands,
composite actions and Dockerfile `FROM`) must start with a prefix; variable-expanded references pass
only when their literal text before the variable does. `--require-digest` needs `@sha256:` plus 64
lowercase hex characters. Behavior without the flags is unchanged.
