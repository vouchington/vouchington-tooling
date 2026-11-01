---
'vouchington-tooling': minor
---

`final-review diff` prints the pull request diff with base and head line numbers on every line, and `final-review bench` gives pillars that numbered diff. Pillars cited diff-file offsets instead of file lines, which misplaced inline comments and hid correct findings from the benchmark.

`final-review bench --judge MODEL` grades findings by claim with a tool-less model call instead of by file and line, and caches the result per model in each raw result.
