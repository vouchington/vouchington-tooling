# Basic Auth exemption facts

Import from `vouchington-tooling/basic-auth-doc-sync`. TypeScript source parsing uses
the optional `@typescript/typescript6` dependency.

- `findBasicAuthExemptPaths(source, variableName)` returns the literal strings in a
  top-level `const` initialized with `new Set([...])`.
- `findBasicAuthExemptMethodsByPath(source, variableName)` returns a map of literal
  paths to literal uppercase HTTP method tokens from `new Map([[path, new Set([...])]])`.
- `findRunbookExemptRoutes(markdown, heading)` reads the first GFM table following
  the configured level-three heading (case insensitive). Columns are named `Path`
  and `Methods`; paths and comma-separated method tokens must be inline code.

All functions return `null` for absent or unsupported declarations/tables. Source
collections must be nonempty and contain only nonempty string literals or static
templates; dynamic expressions are rejected. Literal order and duplicate methods
or documentation rows are preserved for caller validation; repeated map keys follow
Map replacement semantics. The runbook reader accepts short table separators and CRLF.

Callers own symbol names, route inventory, document locations, comparisons, and
diagnostics. These functions return data without exposing AST nodes.

## Source provenance

The fact readers were extracted from `vouchington/vouchington` at
`99a0948e4e3cc0c5b9791062df6e9de37e4cf3f1`:

- `static-code-analysis/targeted-guardrails/basic-auth-doc-sync-parsers.mts`
- `static-code-analysis/targeted-guardrails/basic-auth-doc-sync.test.mts`
- `static-code-analysis/targeted-guardrails/basic-auth-doc-sync-parser-edge.test.mts`

The original parser and its characterization tests informed the extraction. The
first extraction commit misspelled the edge-test basename in its provenance body;
the paths above are the authoritative source list.
