---
'vouchington-tooling': minor
---

Remove the `opencode-code-review` reusable workflow and composite action, and remove the
third-party provider inputs (`anthropic_base_url`, `anthropic_default_*_model`,
`provider_api_token`, `provider_name`, `token_source`/`github_token`) from the `code-review`
workflow and composite actions; the Claude reviewer now authenticates only with
`claude_code_oauth_token` and posts via the Claude App.
