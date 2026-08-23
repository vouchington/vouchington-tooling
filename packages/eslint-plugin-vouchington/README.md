# eslint-plugin-vouchington

Non-generic Vouchington house-style ESLint and Oxlint rules.

## Routing

1. **Generic** — any TypeScript/JavaScript repo would want it → [`eslint-plugin-no-mistakes`](https://github.com/jonathanong/no-mistakes)
2. **Vouchington convention** — shared across Vouchington repos, no product table/SKU/route names → this plugin
3. **Single-repo product coupling** — stays in the product monorepo until it can be parameterized into (2)

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

If `members` is missing or empty, the rule loads and reports nothing. Consumers keep product exceptions in `exclude` / `includeFiles`.

### Options

| Name           | Type       | Required | Default                    |
| -------------- | ---------- | -------- | -------------------------- |
| `members`      | `string[]` | yes      | —                          |
| `include`      | `string[]` | no       | `**/*.{ts,mts,tsx,js,mjs}` |
| `exclude`      | `string[]` | no       | `[]`                       |
| `includeFiles` | `string[]` | no       | `[]`                       |

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
