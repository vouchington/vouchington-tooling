---
'vouchington-tooling': patch
---

`shell-parse` joins backslash-newline continuations before deciding whether a heredoc feeds a shell, so `bash \` + `-s <<'EOF'` exposes its body as a nested script like the one-line form, and a continued `cat \` + `<<'EOF'` body stays data. Quoted `git -c` values already tokenize unquoted; a regression test now pins that.
