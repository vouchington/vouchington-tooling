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

Configure `functions: ['writeRows']` and the shared `include` / `exclude` / `includeFiles` selectors. Optional `promiseMethods` defaults to `['all', 'allSettled', 'any', 'race']`; `iterationMethods` defaults to `['flatMap', 'forEach', 'map']`. With missing/empty `functions` the rule reports nothing. The nearest named function owns the call; unrelated nested functions and shadowed `Promise` bindings are excluded. Function declarations, named callbacks, variable-bound function/arrow expressions, and object/class methods (including private methods and fields) are supported. Type-only and erased ambient declarations do not shadow the runtime `Promise`. The rule follows evaluated expression operands, elements, object values, destructuring defaults, templates, nested calls, and directly invoked function bodies (including inline `call`/`apply`) with defaults triggered by omitted or statically undefined arguments and known array spreads across every call argument. Deferred callbacks, unconsumed generator bodies, and non-static instance-field initializers are excluded; static fields and computed field keys remain eager. A synchronous generator passed directly as the combinator iterable or spread into a container is consumed eagerly. JSX prop and child expressions are also evaluated eagerly. Awaiting the iteration argument does not make an eager drain serial. The rule follows inline syntax and statically known call arguments; it does not infer arbitrary helper return values.

## `factory-owner-location`

Keep configured factory construction in owner files. Detects named, default, and namespace imports; dynamic imports with string, number, boolean, null, or substitution-free template literal specifiers; exact `createRequire(...)(module)` loads with string module ids from `node:module`; constant namespace/factory aliases and object destructuring; and direct calls, `new`, tagged templates, decorators, `Reflect.apply`, and `Reflect.construct`. It also rejects direct factory and namespace reexports through ESM and TypeScript export declarations. CommonJS assignment exports such as `module.exports = factory` remain outside this direct-provenance subset. Scope bindings distinguish these values from unrelated functions with the same names.

If `modules`, `factories`, or `owners` is missing or empty, the rule loads and reports nothing. This rule covers direct, constant provenance. For mutable reassignment, wrapper and container results, `Proxy` and bound-function calls, and virtual matrix lifecycle checks, use `typescript-program-location` below.

### Options

| Name           | Type       | Required | Default                    |
| -------------- | ---------- | -------- | -------------------------- |
| `modules`      | `string[]` | yes      | —                          |
| `factories`    | `string[]` | yes      | —                          |
| `owners`       | `string[]` | yes      | —                          |
| `include`      | `string[]` | no       | `**/*.{ts,mts,tsx,js,mjs}` |
| `exclude`      | `string[]` | no       | `[]`                       |
| `includeFiles` | `string[]` | no       | `[]`                       |

## `typescript-program-location`

Keep configured compiler factory construction in owner files. This rule preserves the flow analysis used by the consuming repository for aliases, reassignment, branches, wrappers, containers, `createRequire`, `Proxy`, bound functions, exports, and virtual matrix test lifecycle. It is separate from the narrower `factory-owner-location` rule; configure one rule for each protected surface as needed.

`modules`, `factories`, and `owners` are required nonempty arrays. The shared `include`, `exclude`, and `includeFiles` selectors choose files to protect. Owner paths and `virtualMatrix.allowLifecycleFiles` are exact paths relative to the lint cwd. With missing or invalid required options, the rule reports nothing.

```json
{
  "vouchington/typescript-program-location": [
    "error",
    {
      "modules": ["@compiler/runtime"],
      "factories": ["createProgram", "createCompilerHost"],
      "owners": ["lib/test-helpers/compiler-owner.mts"],
      "include": ["lib/test-helpers/**/*.mts"],
      "virtualMatrix": {
        "moduleBasename": "virtual-program",
        "builder": "buildVirtualProgramMatrix",
        "testModule": "vitest",
        "testHook": "beforeAll",
        "allowLifecycleFiles": ["lib/test-helpers/virtual-program.test.mts"]
      }
    }
  ]
}
```

`virtualMatrix` is optional. When supplied, all five fields are required. Its `moduleBasename` matches imports and reexports ending in that basename, with or without `.mts`; `builder` names the restricted export. Calls to that builder outside an allowed lifecycle file require `import.meta` as the first argument in a direct callback to the configured test hook. The allowed lifecycle files remain subject to factory construction and export checks.

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
