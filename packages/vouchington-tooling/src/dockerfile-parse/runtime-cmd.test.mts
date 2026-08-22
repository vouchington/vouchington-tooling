import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parseDockerfileRuntimeImages } from './index.mts'

describe('parseDockerfileRuntimeImages', () => {
  const testDirs: string[] = []

  afterEach(() => {
    for (const dir of testDirs.splice(0)) rmSync(dir, { force: true, recursive: true })
  })

  function makeMonorepo(): string {
    const root = mkdtempSync(path.join(tmpdir(), 'dockerfile-parse-runtime-'))
    testDirs.push(root)
    writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: '@workspace/root',
        workspaces: ['services/*', 'apps/api', 'missing/*', 'blocked*'],
      }),
    )
    writeFileSync(path.join(root, 'blocked'), 'not a directory\n')
    for (const [dir, name] of [
      ['services/api', '@entrypoints/api'],
      ['services/worker-cpu', '@entrypoints/worker-cpu'],
      ['services/worker-io', '@entrypoints/worker-io'],
      ['apps/api', '@apps/api'],
    ] as const) {
      const workspace = path.join(root, dir)
      mkdirSync(workspace, { recursive: true })
      writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name }))
      writeFileSync(path.join(workspace, 'serve.mts'), 'export {}\n')
    }
    mkdirSync(path.join(root, 'services', 'empty'), { recursive: true })
    mkdirSync(path.join(root, 'services', 'noname'), { recursive: true })
    writeFileSync(path.join(root, 'services', 'README'), 'not a package\n')
    writeFileSync(path.join(root, 'services', 'noname', 'package.json'), JSON.stringify({}))
    return root
  }

  const combinedDockerfile = `
ARG NODE_VERSION=26
FROM base-node AS deploy-api
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=shared \\
    pnpm deploy --filter @entrypoints/api --prod /prod/api && \\
    node --experimental-strip-types foo
ENV NODE_ENV=production

FROM base-node AS deploy-worker-cpu
RUN pnpm deploy --filter @entrypoints/worker-cpu --prod /prod/worker-cpu

FROM base-node AS deploy-worker-io
RUN pnpm deploy --filter @entrypoints/worker-io --prod /prod/worker-io

FROM runtime-base AS api
COPY --from=deploy-api --chown=65532:65532 /prod/api ./
CMD ["serve.mts"]

FROM runtime-base AS worker-cpu
COPY --from=deploy-worker-cpu /prod/worker-cpu ./
CMD ["serve.mts"]

FROM runtime-base AS worker-io
COPY --from=deploy-worker-io /prod/worker-io ./
CMD ["serve.mts"]
`.trim()

  it('parses at least the api, worker-cpu, and worker-io runtime stages', () => {
    const monorepoRoot = makeMonorepo()
    const images = parseDockerfileRuntimeImages(combinedDockerfile, { monorepoRoot })
    expect(images.map((image) => image.stage)).toEqual(
      expect.arrayContaining(['api', 'worker-cpu', 'worker-io']),
    )
  })

  it.each(['api', 'worker-cpu', 'worker-io'])(
    '%s runtime CMD path resolves to a real file in the deployed workspace',
    (stage) => {
      const monorepoRoot = makeMonorepo()
      const images = parseDockerfileRuntimeImages(combinedDockerfile, { monorepoRoot })
      const image = images.find((candidate) => candidate.stage === stage)
      expect(image).toBeDefined()
      expect(path.join(image!.workspaceDir, image!.cmdPath)).toBe(
        path.join(monorepoRoot, 'services', stage === 'api' ? 'api' : stage, 'serve.mts'),
      )
    },
  )

  it('extracts the pnpm deploy filter for each runtime stage', () => {
    const monorepoRoot = makeMonorepo()
    const filters = Object.fromEntries(
      parseDockerfileRuntimeImages(combinedDockerfile, { monorepoRoot }).map((image) => [
        image.stage,
        image.pnpmFilter,
      ]),
    )
    expect(filters).toMatchObject({
      api: '@entrypoints/api',
      'worker-cpu': '@entrypoints/worker-cpu',
      'worker-io': '@entrypoints/worker-io',
    })
  })

  it('parses multiline RUN deploy commands and COPY flags like --chown', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=shared \\
    pnpm deploy --filter @entrypoints/api --prod /prod/api && \\
    node --experimental-strip-types foo

FROM runtime-base AS api
COPY --from=deploy-api --chown=65532:65532 /prod/api ./
CMD ["serve.mts"]
`.trim()

    const [image] = parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })
    if (!image) throw new Error('expected runtime image for api stage')
    expect(image).toMatchObject({
      stage: 'api',
      pnpmFilter: '@entrypoints/api',
      cmdPath: 'serve.mts',
    })
    expect(path.join(image.workspaceDir, image.cmdPath)).toBe(
      path.join(monorepoRoot, 'services', 'api', 'serve.mts'),
    )
  })

  it('uses the last CMD instruction in a stage', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm deploy --filter @entrypoints/api --prod /prod/api

FROM runtime-base AS api
COPY --from=deploy-api /prod/api ./
CMD ["stale.mts"]
CMD ["serve.mts"]
`.trim()

    const [image] = parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })
    expect(image?.cmdPath).toBe('serve.mts')
  })

  it('parses pnpm deploy commands with pnpm global options', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm -C /app --dir /app deploy --filter @entrypoints/api --prod /prod/api

FROM runtime-base AS api
COPY --from=deploy-api /prod/api ./
CMD ["serve.mts"]
`.trim()

    const [image] = parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })
    expect(image).toMatchObject({
      stage: 'api',
      pnpmFilter: '@entrypoints/api',
      cmdPath: 'serve.mts',
    })
  })

  it('keeps instructions for unnamed stages by using the stage index', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm deploy --filter @entrypoints/api --prod /prod/api

FROM runtime-base
COPY --from=deploy-api /prod/api ./
CMD ["serve.mts"]
`.trim()

    const [image] = parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })
    expect(image).toMatchObject({
      stage: '1',
      pnpmFilter: '@entrypoints/api',
      cmdPath: 'serve.mts',
    })
  })

  it('skips shell-form CMD instructions without throwing', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm deploy --filter @entrypoints/api --prod /prod/api

FROM runtime-base AS api
COPY --from=deploy-api /prod/api ./
CMD node serve.mts
`.trim()

    expect(parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })).toEqual([])
  })

  it('collects every deploy target from a combined RUN instruction', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-all
RUN pnpm deploy --filter @entrypoints/api --prod /prod/api && \\
    pnpm deploy --filter @entrypoints/worker-cpu --prod /prod/worker-cpu

FROM runtime-base AS api
COPY --from=deploy-all /prod/api ./
CMD ["serve.mts"]

FROM runtime-base AS worker-cpu
COPY --from=deploy-all /prod/worker-cpu ./
CMD ["serve.mts"]
`.trim()

    const filters = Object.fromEntries(
      parseDockerfileRuntimeImages(dockerfile, { monorepoRoot }).map((image) => [
        image.stage,
        image.pnpmFilter,
      ]),
    )
    expect(filters).toMatchObject({
      api: '@entrypoints/api',
      'worker-cpu': '@entrypoints/worker-cpu',
    })
  })

  it('uses the copy whose destination is the runtime payload root', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm deploy --filter @entrypoints/api --prod /prod/api
RUN pnpm deploy --filter @entrypoints/worker-cpu --prod /prod/worker-cpu

FROM runtime-base AS api
COPY --from=deploy-api /prod/worker-cpu /opt/sidecar
COPY --from=deploy-api /prod/api ./
CMD ["serve.mts"]
`.trim()

    const [image] = parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })
    expect(image).toMatchObject({
      stage: 'api',
      pnpmFilter: '@entrypoints/api',
    })
  })

  it('honors copySourcePrefix when matching COPY sources', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm deploy --filter @entrypoints/api --prod /deploy/api

FROM runtime-base AS api
COPY --from=deploy-api /deploy/api ./
CMD ["serve.mts"]
`.trim()

    const [image] = parseDockerfileRuntimeImages(dockerfile, {
      monorepoRoot,
      copySourcePrefix: '/deploy/',
    })
    expect(image).toMatchObject({
      stage: 'api',
      pnpmFilter: '@entrypoints/api',
      cmdPath: 'serve.mts',
    })
  })

  it('resolves a non-glob workspace path', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-apps
RUN pnpm deploy --filter @apps/api --prod /prod/apps-api

FROM runtime-base AS apps
COPY --from=deploy-apps /prod/apps-api ./
CMD ["node", "serve.mts"]
`.trim()

    const [image] = parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })
    expect(image).toMatchObject({
      stage: 'apps',
      pnpmFilter: '@apps/api',
      cmdPath: 'serve.mts',
      workspaceDir: path.join(monorepoRoot, 'apps', 'api'),
    })
  })

  it('skips COPY instructions without --from or a payload-root destination', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm deploy --filter @entrypoints/api --prod /prod/api
RUN echo skip

FROM runtime-base AS api
COPY package.json ./
COPY --from=deploy-api /opt/api ./
COPY --from=deploy-api /prod/api /opt/payload
CMD ["serve.mts"]
`.trim()

    expect(parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })).toEqual([])
  })

  it('skips a COPY whose source is not a collected deploy target', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM runtime-base AS api
COPY --from=deploy-api /prod/api ./
CMD ["serve.mts"]
`.trim()

    expect(parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })).toEqual([])
  })

  it('skips a runtime stage that has no CMD', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm deploy --filter @entrypoints/api --prod /prod/api

FROM runtime-base AS api
COPY --from=deploy-api /prod/api ./
`.trim()

    expect(parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })).toEqual([])
  })

  it('throws when the pnpm filter is not a workspace package', () => {
    const monorepoRoot = makeMonorepo()
    const dockerfile = `
FROM base-node AS deploy-missing
RUN pnpm deploy --filter @missing/pkg --prod /prod/missing

FROM runtime-base AS missing
COPY --from=deploy-missing /prod/missing ./
CMD ["serve.mts"]
`.trim()

    expect(() => parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })).toThrow(
      /Workspace package not found for filter: @missing\/pkg/,
    )
  })

  it('throws when the root package.json has no matching workspaces', () => {
    const monorepoRoot = makeMonorepo()
    writeFileSync(
      path.join(monorepoRoot, 'package.json'),
      JSON.stringify({ name: '@workspace/root' }),
    )
    const dockerfile = `
FROM base-node AS deploy-api
RUN pnpm deploy --filter @entrypoints/api --prod /prod/api

FROM runtime-base AS api
COPY --from=deploy-api /prod/api ./
CMD ["serve.mts"]
`.trim()

    expect(() => parseDockerfileRuntimeImages(dockerfile, { monorepoRoot })).toThrow(
      /Workspace package not found for filter: @entrypoints\/api/,
    )
  })
})
