# Impact discovery

Start from the changed surface and trace imports, callers, configuration, generated artifacts, and
tests. Use the repository's graph or search tools where available; otherwise record the evidence
used and the uncertainty that remains. Select focused tests from real dependents, then include
broader validation when a shared contract, package boundary, or generated artifact changes.

Do not treat a tool's incomplete graph as proof that no dependent exists. Escalate uncertain
high-risk boundaries for independent review or a broader test selection.
