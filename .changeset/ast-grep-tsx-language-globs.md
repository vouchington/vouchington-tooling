---
'vouchington-tooling': minor
---

Parse `.ts`/`.mts`/`.cts`/`.tsx` as Tsx in the shipped ast-grep pack so one rule covers script and JSX surfaces. Pack consumers must use the same `languageGlobs` and `language: Tsx`; `-tsx` companion YAML is removed.
