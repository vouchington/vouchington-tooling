---
'vouchington-tooling': patch
---

Packaged skill guidance in the `vouchington-workflow` plugin, bumped to 0.14.2:

- `agent-workflow` implementation: before fixing an issue, find out why the code exists. Delete
  code that no longer serves a purpose instead of fixing it.
- `pr-description`:
  - Write for a reviewer new to the code. Open with a plain-language summary and a **Why**.
  - Add a visible before/after scenario table for any behavior change.
  - Add a Mermaid sequence or flowchart diagram when the flow crosses components.
  - In Impact, give one bullet per audience, and say when the change is active and which
    configuration it reads.
  - Group Details by subsystem, with file and function names. Keep CI history out of the body.
  - Adds a request-flow example.
