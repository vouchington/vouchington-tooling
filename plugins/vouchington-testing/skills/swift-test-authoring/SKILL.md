---
name: swift-test-authoring
description: Add Swift and SwiftUI tests with deterministic state, networking, and view inspection.
---

# Swift test authoring

Test public behavior with deterministic inputs and injected dependencies. For SwiftUI, inspect or
interact through the project's supported test approach; for networking, use a protocol-level test
double and keep request/response synchronization explicit. Avoid sleeps and global state, and keep
fixtures small enough to make failures readable.

Consumer wrappers own test targets, coverage thresholds, view-inspection libraries, and fixture APIs.
