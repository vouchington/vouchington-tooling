---
name: postgres-node-performance-tuning
description: Diagnose and improve PostgreSQL performance in Node.js applications with large data volumes.
---

# PostgreSQL and Node.js performance

Measure the query plan and the workload shape before changing code.

- Select only the required columns.
- Bound each result set. Paginate or stream a large read.
- Batch writes inside an explicit transaction limit.
- Keep connection-pool usage bounded.
- Validate a query change at representative cardinality. Watch latency, memory, lock time, and
  connection pressure together.
- Read [performance patterns](references/performance-patterns.md) before changing a high-volume
  path.

Consumer wrapper owns: schema ownership, operational thresholds, pooling configuration, and rollout.
