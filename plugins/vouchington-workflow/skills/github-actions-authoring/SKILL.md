---
name: github-actions-authoring
description: Author or redesign GitHub Actions workflows around event-driven orchestration, with remote-state polling prohibited.
---

# GitHub Actions authoring

Never poll in CI. A workflow must react to a state transition, not repeatedly ask whether remote
state has changed. Read [github-actions-checklist](../github-actions-checklist/SKILL.md) first, then
all applicable repository-local instructions. Repository policy and the consumer wrapper own
runner labels, permissions, action pins, concurrency, secrets, and required-check names.

## Design the event graph

1. Name the producer, the durable transition it emits, and the consumer that owns the next action.
2. Use `needs` for jobs in one workflow and `workflow_call` for a reusable workflow whose caller
   must await its result. When a consumer must run after failure or skip, give it an explicit status
   condition and inspect `needs.<job>.result`; the implicit success condition skips it otherwise.
3. Use `workflow_run` when a completed workflow is the trusted event boundary. Validate the exact
   source workflow, repository, branch or pull-request head, conclusion, and artifacts before acting.
   The receiving workflow must already exist on the default branch, and GitHub starts at most three
   chained `workflow_run` levels; plan rollout explicitly and collapse deeper chains into one DAG.
4. Use `repository_dispatch` for a cross-repository transition or authenticated external callback.
   Authenticate the sender, pass immutable correlation data, validate it against the source, and make
   duplicate delivery safe. Its receiving workflow must also already exist on the default branch,
   so introduce and verify the receiver before enabling senders.
5. Prefer provider-native completion events, callbacks, queues, or state-machine transitions for
   deployments and services. A scheduled reconciliation workflow may repair missed events, but it
   must inspect a snapshot once and exit; it must not wait for convergence.

## Reject polling designs

Do not add a sleep-and-read loop, repeated run/check/deployment/lease/service queries, a CLI waiter,
or recursive redispatch whose purpose is to observe remote state eventually changing. Timeouts cap
cost but do not make polling event-driven. If the producer cannot emit a usable event, add a bridge
at the producer or provider boundary and let that bridge dispatch the correlated completion event.

Bounded retries are allowed only for the same failed operation when failure is transient and the
operation is idempotent. Local process readiness checks are allowed when the process runs inside the
job and cannot emit a workflow event. Neither exception permits repeated observation of remote state.

## Validate the result

Test accepted, rejected, duplicate, stale, and out-of-order events. Preserve required-check names
and prove that every terminal producer outcome causes one terminal consumer outcome. Run the local
workflow checker and affected tests, then inspect the completed event graph for credentials crossing
untrusted boundaries, missing correlation fields, and any remaining polling path.
