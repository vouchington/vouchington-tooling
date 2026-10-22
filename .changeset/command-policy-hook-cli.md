---
'vouchington-tooling': minor
---

Add `vouchington hook pre-tool-use|post-tool-use --harness claude|codex|cursor|grok --policy <module>`. The hook reads the harness payload on stdin (normalizing Cursor's `Shell` dialect and detecting Grok and Cursor from their own markers), loads the policy module, and either blocks with exit 2 (`pre-tool-use`, which also fails closed when the policy cannot load) or emits `additionalContext` from the module's file checkers and reminder (`post-tool-use`, always exit 0). A repeatable `--automation-env NAME` flag marks extra environment variables as unattended-run markers. The `command-policy` subpath exports the building blocks (`runHook`, `preToolUseOutput`, `postToolUseOutput`, `defineHookPolicy`, and the `HookPolicy` type).
