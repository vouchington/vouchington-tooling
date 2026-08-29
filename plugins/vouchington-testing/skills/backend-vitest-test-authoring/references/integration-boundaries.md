# Integration boundaries

Use real persistence, queue, and internal-service boundaries when the test environment controls
their lifecycle. Mock only external provider edges. Create collision-safe fixture identities and
register event listeners before the mutation that produces them. Cleanup must be ownership-scoped;
never broadly reset shared state used by concurrent tests.

Assert persisted state, emitted work, or externally visible results at the boundary. A mock-only
test is insufficient when import wiring, serialization, transaction behavior, or retries are part
of the contract.
