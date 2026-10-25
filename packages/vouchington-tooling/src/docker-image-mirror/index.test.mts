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
