---
'vouchington-tooling': minor
---

`vouchington-tooling/markdown` exports `parseVisibleMarkdownContent(markdown)`. It returns the prose a reader sees outside every `<details>` block, plus positioned heading, paragraph, list-item, table, fenced-code and raw-HTML blocks. Description policies can use it to measure what a reviewer actually sees.
