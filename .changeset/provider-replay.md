---
'vouchington-tooling': minor
---

Add `vouchington-tooling/provider-replay`. It replays recorded raw `.http` provider responses through
an SDK's `fetch` hook (`createProviderReplay`, `replayClient`) or an AWS SDK v3 client's
`requestHandler` (`createAwsReplayRequestHandler`, `replayAwsClient`), so SDKs parse real wire bytes
and nothing touches the network. `loadRecordedResponse` takes the fixture directory as a required
`fixtureRoot` option. The AWS handler is typed against smithy's `handle` shape and adds no
`@aws-sdk` dependency.
