---
'vouchington-tooling': minor
---

`shell-parse` gains `walkUnquotedShell` (a quote-, escape-, comment-, and `$(...)`-aware character walk) and `splitCommandSegments` (command segments from unquoted separators), plus `keepParentheses` and `markOperators` tokenizer options and an `operator` tag on `ShellWord`. The `gh api` shell-quoting scanner and the retrospective-transcript command-segment splitter now use them instead of their own tokenizers.
