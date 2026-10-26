# Lease patterns

A lease caps work across jobs and survives deferral, which an `ordering` slot does not: a job
moved to delayed keeps its slot until it completes.

## Acquire, renew, release

```ts
const token = randomUUID()
// SET leaseKey token NX PX ttlMs  -> null when another job holds the lease
if (!(await setIfAbsent(leaseKey, token, ttlMs))) {
  return job.moveToDelayed(Date.now() + jitteredDelayMs) // this job only; never falls through
}
try {
  // renew while running, e.g. every ttlMs / 3, only while the stored value equals token
  await doGuardedWork()
} finally {
  await compareAndDelete(leaseKey, token) // script: delete only when the value equals token
}
```

- The TTL is at least the job's `lockDuration`. A shorter lease can expire while the job is
  still active, and a second job then enters the guarded section.
- Renewal and release are scripts that compare the stored value with the token. A plain `DEL`
  can remove a lease another job has since acquired.
- The delay on contention is short, bounded, and jittered so deferred jobs do not wake together.
  `moveToDelayed` defers this job only and keeps its id, cursor, and dedup.

## Quota deferral

When the work defers itself for a quota or rate, release the lease first, then call
`moveToDelayed`. `moveToDelayed` never returns, so a release placed after it does not run, and a
deferred job that keeps the lease blocks the jobs the lease exists to admit.

```ts
await compareAndDelete(leaseKey, token)
await job.moveToDelayed(resumeAt)
```

## Why not the ordering key

Concurrency 1 on a key serializes ready work but lets deferred jobs hold the slot. Raising it to
2 lets two guarded sections overlap, and two deferred jobs still fill both slots. A lease
separates the cap on active work from the queue-order slot.
