# eslint-plugin-vouchington

Non-generic Vouchington house-style ESLint and Oxlint rules.

## Routing

1. **Generic** — any TypeScript/JavaScript repo would want it → [`eslint-plugin-no-mistakes`](https://github.com/jonathanong/no-mistakes)
2. **Vouchington convention** — shared across Vouchington repos, no product table/SKU/route names → this plugin
3. **Single-repo product coupling** — stays in the product monorepo until it can be parameterized into (2)

This package currently ships no rules. Candidates are added only after they pass (2).

```js
// eslint.config.js
import vouchington from 'eslint-plugin-vouchington'

export default [
  {
    plugins: { vouchington },
    rules: {},
  },
]
```
