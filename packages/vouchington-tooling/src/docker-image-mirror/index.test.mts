import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkDockerImageMirrors,
  dockerfileViolations,
  isDockerfilePath,
  workflowImageViolations,
  type Document,
  type ImagePolicy,
} from './index.mts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'docker-mirror-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

describe('checkDockerImageMirrors', () => {
  it('checks only tracked workflow, composite action and Dockerfile inputs', () => {
    const root = repo({
      '.github/workflows/test.yml': 'jobs:\n  build:\n    container: node\n',
      '.github/actions/build/action.yaml': 'runs:\n  image: docker://alpine\n',
      Dockerfile: 'FROM ubuntu\n',
      'unrelated.yml': 'not: [valid',
      '.github/workflows/untracked.yml': 'jobs: [invalid',
    })
    const tracked = [
      '.github/workflows/test.yml',
      '.github/actions/build/action.yaml',
      'Dockerfile',
      'unrelated.yml',
    ]
    expect(checkDockerImageMirrors(root, tracked)).toEqual([
      '.github/workflows/test.yml#build container: node must come from mirror.gcr.io/',
      '.github/actions/build/action.yaml#action image: alpine must come from mirror.gcr.io/',
      'Dockerfile: FROM ubuntu',
    ])
    expect(
      checkDockerImageMirrors(root, ['unrelated.yml', '.github/workflows/deleted.yml']),
    ).toEqual([])
    writeFileSync(join(root, 'Dockerfile'), 'FROM mirror.gcr.io/library/ubuntu\n')
    expect(checkDockerImageMirrors(root, ['Dockerfile'])).toEqual([])
  })

  it('names the configured mirror', () => {
    const root = repo({ '.github/workflows/a.yml': 'jobs:\n  b:\n    container: node\n' })
    expect(
      checkDockerImageMirrors(root, ['.github/workflows/a.yml'], { mirror: 'registry.test' }),
    ).toEqual(['.github/workflows/a.yml#b container: node must come from registry.test/'])
  })

  it('skips empty workflows and names the file of a YAML syntax error', () => {
    const root = repo({
      '.github/workflows/empty.yml': '# only a comment\n',
      '.github/workflows/bad.yml': 'jobs: [invalid',
    })
    expect(checkDockerImageMirrors(root, ['.github/workflows/empty.yml'])).toEqual([])
    expect(() => checkDockerImageMirrors(root, ['.github/workflows/bad.yml'])).toThrow(
      '.github/workflows/bad.yml: ',
    )
  })

  it('does not silently ignore an unreadable tracked input', () => {
    expect(() => checkDockerImageMirrors('/nonexistent-mirror-fixture', ['Dockerfile'])).toThrow(
      'ENOENT',
    )
  })

  it('recognizes Dockerfile names', () => {
    for (const path of ['Dockerfile', 'a/Dockerfile.dev', 'web.Dockerfile'])
      expect(isDockerfilePath(path)).toBe(true)
    expect(isDockerfilePath('Dockerfiles/readme.md')).toBe(false)
  })
})

describe('workflowImageViolations', () => {
  const violations = (document: Document) => workflowImageViolations('w.yml', document)

  it('reads containers, services and docker commands with their option values', () => {
    expect(
      violations({
        jobs: {
          j: {
            container: { image: 'node:22' },
            services: { db: { image: 'postgres' }, ok: { image: 'ghcr.io/a/b' }, none: {} },
            steps: [
              { run: 'docker run --rm -e A=1 -p 80:80 --name n redis:7 cmd' },
              {
                run: 'docker --context c pull docker.io/library/nginx\ndocker image create alpine',
              },
              { run: 'docker run \\\n  -v a:b \\\n  localhost:5000/x' },
              { run: 'docker build .\ndocker run --rm' },
              { run: 'echo hi' },
              {},
            ],
          },
          k: { container: 'mirror.gcr.io/library/node' },
        },
      }).map((v) => v.replace('w.yml#', '')),
    ).toEqual([
      'j container: node:22 must come from mirror.gcr.io/',
      'j service db: postgres must come from mirror.gcr.io/',
      'j: redis:7 must come from mirror.gcr.io/',
      'j: docker.io/library/nginx must come from mirror.gcr.io/',
      'j: alpine must come from mirror.gcr.io/',
    ])
  })

  it('skips the values of less common docker run options', () => {
    expect(
      violations({
        jobs: {
          j: {
            steps: [
              { run: 'docker run --gpus all mirror.gcr.io/library/ubuntu' },
              { run: 'docker run --cidfile ./id alpine' },
              { run: 'docker run --log-opt max-size=1m mirror.gcr.io/x' },
            ],
          },
        },
      }).map((v) => v.replace('w.yml#', '')),
    ).toEqual(['j: alpine must come from mirror.gcr.io/'])
  })

  it('handles bare docker words and flag-only global options', () => {
    expect(
      violations({
        jobs: {
          j: {
            steps: [
              { run: 'docker ; echo' },
              { run: 'docker --debug pull alpine' },
              { run: 'docker container run busybox' },
            ],
          },
        },
      }).map((v) => v.replace('w.yml#', '')),
    ).toEqual([
      'j: alpine must come from mirror.gcr.io/',
      'j: busybox must come from mirror.gcr.io/',
    ])
  })

  it('ignores docker commands that only appear in comments', () => {
    expect(
      violations({
        jobs: {
          j: {
            steps: [{ run: '# docker pull alpine\ndocker pull mirror.gcr.io/a # docker run b' }],
          },
        },
      }),
    ).toEqual([])
  })

  it('reads buildx drivers, docker:// steps and composite actions', () => {
    expect(
      violations({
        jobs: {
          j: {
            steps: [
              { uses: 'docker/setup-buildx-action@v3' },
              { uses: 'docker/setup-buildx-action@v3', with: { driver: 'docker' } },
              {
                uses: 'docker/setup-buildx-action@v3',
                with: { 'driver-opts': 'image=mirror.gcr.io/b' },
              },
              {
                uses: 'docker/setup-buildx-action@v3',
                with: { 'driver-opts': 'image=moby/buildkit' },
              },
              { uses: 'docker://alpine:3' },
              { uses: 'actions/checkout@v4' },
            ],
          },
        },
        runs: { image: 'docker://busybox', steps: [{ run: 'docker pull ubuntu' }] },
      }).map((v) => v.replace('w.yml#', '')),
    ).toEqual([
      'j: moby/buildkit must come from mirror.gcr.io/',
      'j: moby/buildkit must come from mirror.gcr.io/',
      'j: alpine:3 must come from mirror.gcr.io/',
      'action image: busybox must come from mirror.gcr.io/',
      'composite: ubuntu must come from mirror.gcr.io/',
    ])
    expect(violations({ runs: { image: 'Dockerfile' } })).toEqual([])
  })

  it('treats dynamic and scratch references conservatively', () => {
    const images = [
      'scratch',
      '""',
      '$IMAGE',
      '${{ env.IMAGE }}',
      '$REGISTRY/app',
      '${{ vars.R }}/app',
      'private.example.com/app',
      'localhost/app',
      'host:5000/app',
      'node${{ x }}',
      'node${TAG}/app',
      'library/node',
    ]
    const flagged = images.filter(
      (image) => violations({ jobs: { j: { container: image } } }).length > 0,
    )
    expect(flagged).toEqual(['node${{ x }}', 'library/node'])
    expect(violations({ jobs: { j: { steps: [{ run: 'docker run -it' }] } } })).toEqual([])
  })
})

describe('dockerfileViolations', () => {
  it('flags Hub FROM, COPY --from and syntax lines but not stages or numeric indexes', () => {
    const source = [
      '# syntax=docker/dockerfile:1',
      'FROM node:22 AS build',
      'FROM --platform=linux/amd64 build AS again',
      'FROM scratch',
      'FROM mirror.gcr.io/library/alpine',
      'COPY --from=build /a /b',
      'COPY --chown=1 --from=0 /a /b',
      'COPY --from=nginx /a /b',
      'COPY --from=mirror.gcr.io/library/nginx /a /b',
      'COPY . .',
      'RUN echo \\',
      '  FROM ignored',
    ].join('\n')
    expect(dockerfileViolations('Dockerfile', source)).toEqual([
      'Dockerfile: # syntax=docker/dockerfile:1',
      'Dockerfile: FROM node:22',
      'Dockerfile: COPY --from=nginx',
    ])
    expect(
      dockerfileViolations('Dockerfile', '# syntax=mirror.gcr.io/docker/dockerfile\n'),
    ).toEqual([])
  })
})

describe('image policy', () => {
  const digest = `@sha256:${'0'.repeat(64)}`
  const allow = ['ghcr.io/v/dependency-']
  const check = (
    document: Document,
    policy: ImagePolicy = { allowRegistries: allow, requireDigest: true },
  ) =>
    workflowImageViolations('w.yml', document, 'm.test', policy).map((v) => v.replace('w.yml#', ''))

  it('requires every workflow image to start with an allowed prefix and pin a digest', () => {
    expect(
      check({
        jobs: {
          j: {
            container: `ghcr.io/v/dependency-node${digest}`,
            services: {
              db: { image: 'mirror.gcr.io/postgres' },
              ok: { image: `ghcr.io/v/dependency-p${digest}` },
            },
            steps: [
              { run: `docker run ghcr.io/v/dependency-x:1` },
              { uses: 'docker://alpine' },
              { run: 'docker pull scratch' },
            ],
          },
        },
        runs: { image: 'docker://ghcr.io/v/other@sha256:abc' },
      }),
    ).toEqual([
      'j service db: mirror.gcr.io/postgres must start with "ghcr.io/v/dependency-"; must be pinned with @sha256:<64 lowercase hex characters>',
      'j: ghcr.io/v/dependency-x:1 must be pinned with @sha256:<64 lowercase hex characters>',
      'j: alpine must start with "ghcr.io/v/dependency-"; must be pinned with @sha256:<64 lowercase hex characters>',
      'action image: ghcr.io/v/other@sha256:abc must start with "ghcr.io/v/dependency-"; must be pinned with @sha256:<64 lowercase hex characters>',
    ])
  })

  it('rejects uppercase or short digests and Hub even when digest-only', () => {
    const images = [`a/b@sha256:${'A'.repeat(64)}`, `a/b@sha256:${'0'.repeat(63)}`, `a/b${digest}`]
    const flagged = images.filter(
      (image) =>
        check({ jobs: { j: { container: image } } }, { allowRegistries: [], requireDigest: true })
          .length > 0,
    )
    expect(flagged).toEqual([
      `a/b@sha256:${'A'.repeat(64)}`,
      `a/b@sha256:${'0'.repeat(63)}`,
      `a/b${digest}`,
    ])
    expect(
      check({ jobs: { j: { container: `ghcr.io/a/b${digest}` } } }, { requireDigest: true }),
    ).toEqual([])
  })

  it('judges variable-expanded references by their literal text', () => {
    const images = [
      '$IMAGE',
      '${{ env.IMAGE }}',
      'ghcr.io/v/${{ x }}',
      `ghcr.io/v/dependency-${'${{ x }}'}${digest}`,
      `ghcr.io/v/dependency-node@sha256:${'${{ d }}'}`,
    ]
    const flagged = images.filter(
      (image) => check({ jobs: { j: { container: image } } }).length > 0,
    )
    expect(flagged).toEqual([
      '$IMAGE',
      '${{ env.IMAGE }}',
      'ghcr.io/v/${{ x }}',
      `ghcr.io/v/dependency-node@sha256:${'${{ d }}'}`,
    ])
  })

  it('keeps Dockerfile stage aliases, scratch and numeric indexes exempt', () => {
    const source = [
      '# syntax=docker/dockerfile:1',
      `FROM ghcr.io/v/dependency-node${digest} AS build`,
      'FROM build AS again',
      'FROM scratch',
      'FROM alpine',
      'COPY --from=build /a /b',
      'COPY --from=0 /a /b',
      'COPY --from=nginx /a /b',
    ].join('\n')
    expect(
      dockerfileViolations('Dockerfile', source, { allowRegistries: allow, requireDigest: true }),
    ).toEqual([
      'Dockerfile: # syntax=docker/dockerfile:1 must start with "ghcr.io/v/dependency-"; must be pinned with @sha256:<64 lowercase hex characters>',
      'Dockerfile: FROM alpine must start with "ghcr.io/v/dependency-"; must be pinned with @sha256:<64 lowercase hex characters>',
      'Dockerfile: COPY --from=nginx must start with "ghcr.io/v/dependency-"; must be pinned with @sha256:<64 lowercase hex characters>',
    ])
    expect(
      dockerfileViolations('Dockerfile', 'FROM node\n', { requireDigest: true }, 'm.test'),
    ).toEqual([
      'Dockerfile: FROM node must come from m.test/; must be pinned with @sha256:<64 lowercase hex characters>',
    ])
  })

  it('passes the policy through checkDockerImageMirrors', () => {
    const root = repo({
      '.github/workflows/a.yml': 'jobs:\n  b:\n    container: mirror.gcr.io/node\n',
      Dockerfile: 'FROM mirror.gcr.io/node\n',
    })
    expect(
      checkDockerImageMirrors(root, ['.github/workflows/a.yml', 'Dockerfile'], {
        allowRegistries: ['ghcr.io/x/'],
      }),
    ).toEqual([
      '.github/workflows/a.yml#b container: mirror.gcr.io/node must start with "ghcr.io/x/"',
      'Dockerfile: FROM mirror.gcr.io/node must start with "ghcr.io/x/"',
    ])
    expect(checkDockerImageMirrors(root, ['Dockerfile'], { allowRegistries: [] })).toEqual([])
  })
})
