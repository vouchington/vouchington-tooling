# eslint-plugin-vouchington

Non-generic Vouchington house-style ESLint and Oxlint rules.

## Routing

1. **Generic** — any TypeScript/JavaScript repo would want it → [`eslint-plugin-no-mistakes`](https://github.com/jonathanong/no-mistakes)
2. **Vouchington convention** — shared across Vouchington repos, no product table/SKU/route names → this plugin
3. **Product-specific policy** — paths, names and narrow exceptions stay in consumer configuration; AST implementations belong upstream.

```js
// eslint.config.js
import vouchington from 'eslint-plugin-vouchington'

export default [
  {
    plugins: { vouchington },
    rules: {
      'vouchington/postgres-cursor-call-contract': [
        'error',
        {
          modules: ['@db/cursors'],
          executors: ['runCursor', 'runCursorBatches'],
        },
      ],
    },
  },
]
```

## `postgres-cursor-call-contract`

Require cursor helpers imported from configured modules to be called directly, with SQL that starts with a static `/* name */` annotation.

If `modules` or `executors` is missing or empty, the rule loads and reports nothing.

### Options

| Name           | Type       | Required | Default                     |
| -------------- | ---------- | -------- | --------------------------- |
| `modules`      | `string[]` | yes      | —                           |
| `executors`    | `string[]` | yes      | —                           |
| `include`      | `string[]` | no       | `**/*.{ts,mts,tsx,js,mjs}`  |
| `exclude`      | `string[]` | no       | `[]`                        |
| `includeFiles` | `string[]` | no       | `[]`                        |
| `annotation`   | `string`   | no       | `^\\s*/\\*\\s*\\S[^]*?\\*/` |

`include` and `exclude` are picomatch globs relative to the lint cwd. `includeFiles` are exact relative paths that stay in even when `exclude` matches.

## `banned-member-read`

Ban reads of configured object members, including object-pattern aliases. Assignments and `delete` are allowed.

If `members` is missing or empty, the rule loads and reports nothing. File-wide selection uses `include` / `exclude` / `includeFiles`. Narrow binding-aware exceptions use `exceptions`, so other reads in the same helper remain protected.

### Options

| Name           | Type       | Required | Default                    |
| -------------- | ---------- | -------- | -------------------------- |
| `members`      | `string[]` | yes      | —                          |
| `include`      | `string[]` | no       | `**/*.{ts,mts,tsx,js,mjs}` |
| `exclude`      | `string[]` | no       | `[]`                       |
| `includeFiles` | `string[]` | no       | `[]`                       |

### Binding-aware member exceptions

Each exception specifies an exact relative `file`, banned `member`, imported constructor `module` / `imported` name, and required `local` binding name. Leading `./` segments are normalized consistently with file selection. The rule verifies the import binding, so shadowed and lookalike constructors remain forbidden.

- `kind: 'constructor-constant'` additionally requires `constant: { name, value }`. Only a non-optional direct constructor member call with one argument bound to that exact literal `const` is allowed. Static template literals and transparent TypeScript assertions preserve the verified value.
- `kind: 'const-instance-prefix'` additionally requires `prefix`. Only a direct zero-argument call on an unreassigned `const` instance is allowed. Its constructor options must have that effective literal `prefix`; later spreads, computed keys or conflicting duplicate prefixes invalidate it. Optional calls remain forbidden.

Aliases, extracted methods and destructured reads do not inherit exceptions. Exception data is configuration, not executable AST callbacks.

## `serial-cursor-drains`

Reject an unshadowed global `Promise` combinator called with an eager collection iteration inside a configured draining function. This protects configured streams from starting all drains before previous database clients are released; ordinary serial iteration is allowed.

Configure `functions: ['writeRows']` and the shared `include` / `exclude` / `includeFiles` selectors. Optional `promiseMethods` defaults to `['all', 'allSettled', 'any', 'race']`; `iterationMethods` defaults to `['flatMap', 'forEach', 'map']`. With missing/empty `functions` the rule reports nothing. The nearest named function owns the call; unrelated nested functions and shadowed `Promise` bindings are excluded. Function declarations, named callbacks, variable-bound function/arrow expressions, and object/class methods (including private methods and fields) are supported. Type-only and erased ambient declarations do not shadow the runtime `Promise`. The rule follows eager branches, elements, nested calls, and directly invoked function bodies while excluding deferred callbacks and generator bodies. Awaiting the iteration argument does not make an eager drain serial.

## `factory-owner-location`

Keep configured factory calls in owner files. Detects named imports, namespace members, and `createRequire(...)(module)` provenance from `node:module`.

If `modules`, `factories`, or `owners` is missing or empty, the rule loads and reports nothing. Virtual-program / test-lifecycle overlays stay in the consuming repo.

### Options

| Name           | Type       | Required | Default                    |
| -------------- | ---------- | -------- | -------------------------- |
| `modules`      | `string[]` | yes      | —                          |
| `factories`    | `string[]` | yes      | —                          |
| `owners`       | `string[]` | yes      | —                          |
| `include`      | `string[]` | no       | `**/*.{ts,mts,tsx,js,mjs}` |
| `exclude`      | `string[]` | no       | `[]`                       |
| `includeFiles` | `string[]` | no       | `[]`                       |

### Oxlint

```json
{
  "jsPlugins": [{ "name": "vouchington", "specifier": "eslint-plugin-vouchington" }],
  "plugins": [],
  "rules": {
    "vouchington/postgres-cursor-call-contract": [
      "error",
      {
        "modules": ["@db/cursors"],
        "executors": ["runCursor", "runCursorBatches"],
        "exclude": ["**/*.test.mts"],
        "includeFiles": ["lib/test-helpers/seed.mts"]
      }
    ]
  }
}
```
