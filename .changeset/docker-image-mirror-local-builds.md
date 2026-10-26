---
'vouchington-tooling': patch
---

`docker-image-mirror` no longer applies `--allow-registry` and `--require-digest` to images the same workflow file or composite action builds locally: references equal to a `docker build`/`docker buildx build`/`podman build` tag or a `docker/build-push-action` (`load: true`) tag, or to `${{ steps.<id>.outputs.<name> }}` of such a build step, are exempt.
