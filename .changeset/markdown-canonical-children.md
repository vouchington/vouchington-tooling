---
'vouchington-tooling': minor
---

Add the `vouchington-tooling/markdown-canonical-children` subpath. `readCanonicalMarkdownChildren` composes a split Markdown index with its whole-file linked children (tracked, in-repo, symlink-safe, non-recursive) and maps composed lines and offsets back to their source file and line. `checkCanonicalChildLinks(ctx, { parents })` reports children in the listed split parents that are linked only by a `#fragment`; the parent paths are supplied by the caller. The link helpers (`canonicalWholeFileTargets`, `canonicalWholeFileLinks`, `canonicalFragmentTargets`, `fragmentOnlyCanonicalChildTargets`) are exported too.
