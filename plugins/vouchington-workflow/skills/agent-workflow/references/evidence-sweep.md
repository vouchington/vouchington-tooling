# Evidence sweep

Map every acceptance criterion to a focused test, inspection, or manual verification with a concrete
result. Run the required broader checks after focused validation. Treat skipped validation as a
finding: state the blocker, affected surface, and remaining risk.

Before handoff, compare the final diff to the accepted decision ledger and verify documentation,
generated output, and public contracts agree with the implementation.

When one semantic defect is found, search sibling call and write sites for the same shape; record
why remaining matches are safe. Keep large logs and analysis artifacts outside the agent context,
and report bounded findings and their evidence rather than raw payloads.
