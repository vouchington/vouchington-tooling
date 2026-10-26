---
'vouchington-tooling': patch
---

`docker-image-mirror` resolves `docker run|pull|create` image arguments `$VAR`, `"$VAR"` and `${VAR}` through an earlier assignment in the same `run:` block, records build tags that contain variables or expressions as normalized text (with step `env:` input mappings), treats `docker/metadata-action` `images:` consumed by a loaded `docker/build-push-action` or non-pushing `docker/bake-action` as locally built repositories, and no longer keeps the `)` of `$(docker run ... "$IMAGE")` on the token. A new repeatable `--allow-ref-expression <exact text>` flag (library option `allowRefExpressions`) exempts an image reference whose raw text exactly equals the value; an empty value exits 2.
