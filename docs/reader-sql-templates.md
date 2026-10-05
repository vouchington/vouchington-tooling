# Publication reader SQL templates

`vouchington-tooling/post-publication-inventory` exports
`extractStaticSqlTemplateQuasis(content, options): string[]` and `ReaderSqlTemplateOptions`.
This collects source facts. The caller owns tracked files, reader scopes, table names,
eligibility checks, inventory validation, and diagnostics.

```ts
import { extractStaticSqlTemplateQuasis } from 'vouchington-tooling/post-publication-inventory'

const fragments = extractStaticSqlTemplateQuasis(content, {
  templateTag: 'queryText',
  appendMethod: 'extend',
  executorImports: new Map([['fixture-db', new Set(['fetchRows', 'execute'])]]),
  placeholderPrefix: 'parameter_',
})
```

All identifiers are caller-supplied. Named executor imports, including aliases, are
recognized only from configured modules. Conditional aliases are collected in traversal
order when either branch names a known executor. Namespace/default imports are excluded.
The analysis remains name-based: it does not prove binding identity or exclude shadowed
calls and does not follow arbitrary alias chains or unwrap assertions. Parentheses
are transparent, matching the source parser's previous representation.

Explicit `return` statements, exported variable declarations, and direct executor arguments
are collected. Export-list specifiers and expression-bodied arrow returns are outside this
source-fact collector's current heuristic.
Binding references in returns, executor arguments, conditional executor aliases, and append
receivers require identifiers; ordinary string values cannot consume a same-named binding.
Static string computed method names remain supported for configured append calls.
Only bare templates and templates with the configured simple tag are accepted. Raw quasi
text is retained, and each interpolation becomes the configured prefix plus a one-based
index. Direct fragments precede consumed variable bindings; repeated references do not
duplicate a binding's fragment. Empty templates are excluded.

Configured append calls on simple named receivers concatenate their first static template
argument only when the call follows the recorded declaration. Computed string method
names are supported; fluent-chain receivers and dynamic arguments are not reconstructed.
Appends remain collected across branches and after returns. Alternate branches precede
consequents, callbacks precede chained call receivers, and function/loop bodies precede
their headers, preserving the current inventory analyzer's collection order. These facts
are an approximation of source structure, not execution or control-flow proof.

The existing compiler peer parses the source, with syntax diagnostics rejected before
facts are collected. No PostgreSQL parser is used. This API does not replace SQL AST
protection, boundary/dataflow analysis, or reader-discovery policy.
