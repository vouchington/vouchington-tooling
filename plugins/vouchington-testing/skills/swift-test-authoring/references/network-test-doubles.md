# Network test doubles

Delayed URLProtocol callbacks must honor `stopLoading()`: guard delivery with synchronized stopped
state so cancellation cannot call a released client. Keep shared response and captured-request state
private behind one synchronization boundary, reset related fields atomically, and expose coherent
snapshots for assertions.

Avoid sleeping to coordinate tests. Inject scheduling or await explicit completion so networking,
view state, and cancellation remain deterministic under parallel execution.
