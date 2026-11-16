---
'vouchington-tooling': patch
---

vouchington-workflow 0.25.1: triage-sweep closes three gaps from #812. Phase F checks for
reviews with only a body on every sweep, so they no longer depend on the weekly backstop and can
no longer age out of the window. Phase H maintains the fallback job only inside a standing loop,
so a standalone pass no longer creates recurring work. Phase G2 lists command comments from its
own success-only `commandsThrough` cursor (a new `state.py` field), so a skipped G2 no longer drops
the commands posted before it.
