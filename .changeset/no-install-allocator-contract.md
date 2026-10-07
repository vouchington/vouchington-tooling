---
'vouchington-tooling': patch
---

Guarantee the browser-safe port allocator runs without an install: tests pack the real tarball, run `scripts/allocate-browser-safe-ports.py` from an empty directory with `python3 -I -S`, and statically enforce stdlib-only imports. The README documents running it from the extracted tarball instead of `pnpm dlx`.
