# Core test practice

Choose the lowest realistic boundary that can observe the contract. Mock external systems and
uncontrolled infrastructure; exercise internal module composition where practical. Test behavior,
failure paths, authorization, and security-relevant validation rather than private calls.

Start with a failing test when the behavior is testable. Finish only when the production path, its
public contract, documentation, and generated artifacts move together. Do not leave placeholders or
test-only production branches. For every acceptance criterion, retain evidence from a focused test,
review, or explicitly justified manual check.
