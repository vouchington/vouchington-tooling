import { describe, expect, it } from 'vitest'

import { parseDockerfilePrewarmStages, type DockerfilePrewarmStage } from './index.mts'

function findMismatches(
  stages: readonly DockerfilePrewarmStage[],
): readonly DockerfilePrewarmStage[] {
  return stages
    .filter((stage) => stage.copySource?.startsWith('/prod/worker-'))
    .filter((stage) => stage.envPort === undefined || stage.envPort !== stage.monitoredPort)
}

const combinedDockerfile = `
ARG NODE_PREWARM_VERSION=0.3.0
FROM base-node AS api-prewarm
COPY --link --from=deploy-api /prod/api ./
ARG NODE_PREWARM_VERSION=0.3.0
RUN NODE_PREWARM=1 \\
    npx --yes node-prewarm@\${NODE_PREWARM_VERSION} "/nodejs/bin/node serve.mts" --port 3000

FROM base-node AS worker-cpu-prewarm
COPY --link --from=deploy-worker-cpu /prod/worker-cpu ./
ARG NODE_PREWARM_VERSION=0.3.0
RUN NODE_PREWARM=1 NODE_PREWARM_PORT=3001 \\
    npx --yes node-prewarm@\${NODE_PREWARM_VERSION} "/nodejs/bin/node serve.mts" --port 3001

FROM base-node AS worker-io-prewarm
COPY --link --from=deploy-worker-io /prod/worker-io ./
ARG NODE_PREWARM_VERSION=0.3.0
RUN NODE_PREWARM=1 NODE_PREWARM_PORT=3002 \\
    npx --yes node-prewarm@\${NODE_PREWARM_VERSION} "/nodejs/bin/node serve.mts" --port 3002
`.trim()

describe('parseDockerfilePrewarmStages', () => {
  it('parses the api, worker-cpu, and worker-io prewarm stages', () => {
    expect(parseDockerfilePrewarmStages(combinedDockerfile).map((stage) => stage.stage)).toEqual([
      'api-prewarm',
      'worker-cpu-prewarm',
      'worker-io-prewarm',
    ])
  })

  it('every worker prewarm stage sets NODE_PREWARM_PORT matching its --port value', () => {
    expect(findMismatches(parseDockerfilePrewarmStages(combinedDockerfile))).toEqual([])
  })

  it('the api prewarm stage has no /prod/worker- COPY and is exempt from the rule', () => {
    const api = parseDockerfilePrewarmStages(combinedDockerfile).find(
      (stage) => stage.stage === 'api-prewarm',
    )
    expect(api?.copySource).toBe('/prod/api')
  })

  it('flags a worker prewarm stage missing NODE_PREWARM_PORT', () => {
    const fixture = `
FROM base-node AS worker-foo-prewarm
COPY --link --from=deploy-worker-foo /prod/worker-foo ./
ARG NODE_PREWARM_VERSION=0.3.0
RUN NODE_PREWARM=1 \\
    npx --yes node-prewarm@\${NODE_PREWARM_VERSION} "/nodejs/bin/node serve.mts" --port 4000
`.trim()

    expect(findMismatches(parseDockerfilePrewarmStages(fixture))).toEqual([
      {
        stage: 'worker-foo-prewarm',
        copySource: '/prod/worker-foo',
        monitoredPort: 4000,
        envPort: undefined,
      },
    ])
  })

  it('flags a worker prewarm stage whose NODE_PREWARM_PORT does not match --port', () => {
    const fixture = `
FROM base-node AS worker-foo-prewarm
COPY --link --from=deploy-worker-foo /prod/worker-foo ./
ARG NODE_PREWARM_VERSION=0.3.0
RUN NODE_PREWARM=1 NODE_PREWARM_PORT=4001 \\
    npx --yes node-prewarm@\${NODE_PREWARM_VERSION} "/nodejs/bin/node serve.mts" --port 4000
`.trim()

    expect(findMismatches(parseDockerfilePrewarmStages(fixture))).toEqual([
      {
        stage: 'worker-foo-prewarm',
        copySource: '/prod/worker-foo',
        monitoredPort: 4000,
        envPort: 4001,
      },
    ])
  })

  it('passes a worker prewarm stage whose NODE_PREWARM_PORT matches --port', () => {
    const fixture = `
FROM base-node AS worker-foo-prewarm
COPY --link --from=deploy-worker-foo /prod/worker-foo ./
ARG NODE_PREWARM_VERSION=0.3.0
RUN NODE_PREWARM=1 NODE_PREWARM_PORT=4000 \\
    npx --yes node-prewarm@\${NODE_PREWARM_VERSION} "/nodejs/bin/node serve.mts" --port 4000
`.trim()

    expect(findMismatches(parseDockerfilePrewarmStages(fixture))).toEqual([])
  })

  it('ignores a non-worker prewarm stage regardless of NODE_PREWARM_PORT', () => {
    const fixture = `
FROM base-node AS api-prewarm
COPY --link --from=deploy-api /prod/api ./
ARG NODE_PREWARM_VERSION=0.3.0
RUN NODE_PREWARM=1 \\
    npx --yes node-prewarm@\${NODE_PREWARM_VERSION} "/nodejs/bin/node serve.mts" --port 3000
`.trim()

    expect(findMismatches(parseDockerfilePrewarmStages(fixture))).toEqual([])
  })

  it('skips stages that do not invoke the prewarm binary', () => {
    const fixture = `
FROM runtime-base AS worker-foo
COPY --from=deploy-worker-foo /prod/worker-foo ./
CMD ["serve.mts"]
`.trim()

    expect(parseDockerfilePrewarmStages(fixture)).toEqual([])
  })

  it('parses an unversioned prewarm binary and skips COPY without a payload-root dest', () => {
    const fixture = `
FROM base-node AS worker-foo-prewarm
COPY package.json ./
COPY --from=deploy-worker-foo /prod/worker-foo /opt/payload
RUN node-prewarm "/nodejs/bin/node serve.mts" --port 4000
`.trim()

    expect(parseDockerfilePrewarmStages(fixture)).toEqual([
      {
        stage: 'worker-foo-prewarm',
        copySource: undefined,
        monitoredPort: 4000,
        envPort: undefined,
      },
    ])
  })

  it('returns undefined ports when --port is missing, incomplete, or non-numeric', () => {
    const fixture = `
FROM base-node AS missing-port
RUN node-prewarm "/nodejs/bin/node serve.mts"

FROM base-node AS dangling-port
RUN node-prewarm "/nodejs/bin/node serve.mts" --port

FROM base-node AS invalid-port
RUN node-prewarm "/nodejs/bin/node serve.mts" --port abc NODE_PREWARM_PORT=nope
`.trim()

    expect(parseDockerfilePrewarmStages(fixture)).toEqual([
      {
        stage: 'missing-port',
        copySource: undefined,
        monitoredPort: undefined,
        envPort: undefined,
      },
      {
        stage: 'dangling-port',
        copySource: undefined,
        monitoredPort: undefined,
        envPort: undefined,
      },
      {
        stage: 'invalid-port',
        copySource: undefined,
        monitoredPort: undefined,
        envPort: undefined,
      },
    ])
  })

  it('honors copySourcePrefix, prewarmBinary, and prewarmPortEnv options', () => {
    const fixture = `
FROM base-node AS worker-foo-prewarm
COPY --link --from=deploy-worker-foo /deploy/worker-foo .
RUN READY_PORT=4000 warmup@1.0.0 "/nodejs/bin/node serve.mts" --port 4000
`.trim()

    expect(
      parseDockerfilePrewarmStages(fixture, {
        copySourcePrefix: '/deploy/',
        prewarmBinary: 'warmup',
        prewarmPortEnv: 'READY_PORT',
      }),
    ).toEqual([
      {
        stage: 'worker-foo-prewarm',
        copySource: '/deploy/worker-foo',
        monitoredPort: 4000,
        envPort: 4000,
      },
    ])
  })
})
