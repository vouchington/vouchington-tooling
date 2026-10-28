---
'vouchington-tooling': minor
---

Add the `vouchington-tooling/markdown-article-links` subpath. `checkMarkdownArticleLinks` renders caller-supplied markdown through caller-supplied `parse`, `rewrite` and `render` callbacks and reports local hrefs that still end in `.md` (`residual-md`), article-route targets no input provides (`missing-target`) and shared slugs (`duplicate-slug`). `discoverMarkdownArticles` lists git-tracked `*.md` files directly under a root with `git ls-files`, excludes `README.md` by default, and throws on empty discovery unless `allowEmpty` is set.
