---
'vouchington-tooling': minor
---

`storybookBundleHasStory` (`vouchington-tooling/playwright`) now throws the exported
`StorybookIndexAccessError` when the Storybook index request fails or returns a non-OK HTTP status,
instead of returning `false`. The error carries `kind` (`request` or `http`) and the numeric HTTP
`status` when available, and omits request URLs, credentials, and response bodies. A readable index
without the requested story still returns `false`, and malformed JSON still rejects.
