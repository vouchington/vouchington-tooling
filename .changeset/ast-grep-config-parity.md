---
'vouchington-tooling': minor
---

Add the `vouchington-tooling/ast-grep-config-parity` subpath. `checkAstGrepConfigParity` is a synchronous, I/O-free check that `sgconfig.yml` `ruleDirs` is exactly the local rule directory and `languageGlobs` equals the expected mapping, that no local rule copies a pack rule (by relative path or basename), that local discovery is non-empty, that every rule's `language` matches the default or its listed exception (stale exceptions are reported), that no `-tsx` companion remains, and that all YAML parses. `discoverAstGrepConfig` reads `sgconfig.yml`, lists git-tracked rule YAML recursively with `git ls-files`, lists the installed pack from disk, and throws on empty discovery (local unless `allowEmpty`; the pack always).
