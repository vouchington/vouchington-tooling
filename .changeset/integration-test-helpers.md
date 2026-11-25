---
'vouchington-tooling': minor
---

Add the test-only `vouchington-tooling/integration-test-helpers` subpath containing generic multi-process HTTP integration test machinery (with product fixtures kept in consumers).

New exports on `vouchington-tooling/integration-test-helpers`:

- Transport & readiness: `isRetryableTransportError`, `isIdempotentHttpMethod`, `FetchResponseRejectedError`, `fetchWithTransportRetry`, `retryOnTransportError`, `waitFor`, `isHealthy`, `poll`
- Process supervision & diagnostics: `startManagedProcess`, `waitForService`, `watchForPostReadyExit`, `serviceExitMessage`, `formatExitStatus`, `readRecentLog`, `POST_READY_EXIT_MARKER_PREFIX`
- Fetch-safe loopback port allocation: `FETCH_FORBIDDEN_PORTS`, `isFetchForbiddenPort`, `isFetchSafePort`, `allocateReservedPorts`, `reserveLoopbackPorts`, `listenOnFetchSafeEphemeralPort`, `listenOnFetchSafeLoopback`, `readKernelEphemeralPortRange`, `servicePortBand`
- Trace proxy & cross-process asset concurrency broker: `createTraceProxy`, `buildUpstreamHeaders`, `ASSET_CONCURRENCY_PATH`, `createAssetConcurrencyBroker`, `createCrossProcessConcurrencyLimiter`
- Cookies, artifacts, cache & runtime harness: `WebIntegrationCookies`, `writePageArtifact`, `printTrace`, `createAssetMetadataCache`, `startReservedProcess`, `ensureRequiredPathsExist`, `cleanupManagedServices`, `closeWebApiClientRuntime`, `withWebApiClientRuntime`, `createLoopbackClientFetch`
