import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  checkDockerImageMirrors,
  workflowImageViolations,
  type Document,
  type ImagePolicy,
} from './index.mts'
import { collectLocalBuilds } from './local-builds.mts'

const strict = { allowRegistries: ['ghcr.io/vouchington/'], requireDigest: true }
const check = (document: Document, policy: ImagePolicy = strict) =>
  workflowImageViolations('w.yml', document, undefined, policy).map((v) => v.replace('w.yml#', ''))
const rejected = (where: string, image: string) =>
  `${where}: ${image} must start with "ghcr.io/vouchington/"; must be pinned with @sha256:<64 lowercase hex characters>`

describe('collectLocalBuilds', () => {
  it('collects literal tags from every build command form', () => {
    const { tags, stepIds } = collectLocalBuilds([
      {
        id: 'a',
        run: [
          'docker build -t one .',
          'docker buildx build --tag two --tag=three -t "four" .',
          'podman build -t five . # -t ignored',
          'docker build -t "$IMG" -t six-${{ github.sha }} -t',
          'docker image ls',
          'docker build',
        ].join('\n'),
      },
      { id: 'b', uses: 'docker/build-push-action@v6', with: { load: true, tags: 'x\ny, z\n' } },
      { id: 'c', uses: 'docker/build-push-action@v6', with: { load: 'true', tags: 7 } },
      { id: 'd', uses: 'docker/build-push-action@v6', with: { push: true, tags: 'nope' } },
      { id: 'e', run: 'echo hi' },
      { uses: 'docker/build-push-action@v6', with: { load: true, tags: 'noid' } },
      { run: 'docker build \\\n  -t multi .' },
    ])
    expect([...tags].sort()).toEqual(
      ['five', 'four', 'multi', 'noid', 'one', 'three', 'two', 'x', 'y', 'z'].sort(),
    )
    expect([...stepIds].sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('local build exemptions', () => {
  it('exempts exact tags built in the same file, from run steps and composite actions', () => {
    const doc: Document = {
      jobs: {
        j: {
          steps: [
            { run: 'docker build -t validation:ci .' },
            { run: 'docker run validation:ci\ndocker run validation:other' },
            { run: 'docker run ghcr.io/vouchington/dependency-x:1' },
          ],
        },
      },
    }
    expect(check(doc)).toEqual([
      rejected('j', 'validation:other'),
      rejected('j', 'ghcr.io/vouchington/dependency-x:1').replace(
        'must start with "ghcr.io/vouchington/"; ',
        '',
      ),
    ])
    expect(
      check({
        runs: {
          steps: [{ run: 'podman build --tag=local/img .' }, { run: 'docker run "local/img"' }],
        },
      }),
    ).toEqual([])
    expect(
      check({
        jobs: {
          j: { steps: [{ run: 'docker build -t validation:ci .\ndocker run validation:ci' }] },
        },
      }),
    ).toEqual([])
  })

  it('exempts build-push-action tags only with load: true', () => {
    const run = { run: 'docker run app:ci\ndocker run other:ci' }
    const loaded = {
      uses: 'docker/build-push-action@v6',
      with: { load: true, tags: 'app:ci,\nextra:ci' },
    }
    expect(check({ jobs: { j: { steps: [loaded, run] } } })).toEqual([rejected('j', 'other:ci')])
    const pushed = { uses: 'docker/build-push-action@v6', with: { tags: 'app:ci' } }
    expect(check({ jobs: { j: { steps: [pushed, run] } } })).toHaveLength(2)
  })

  it('exempts the step-output form only for build steps', () => {
    const doc: Document = {
      jobs: {
        j: {
          steps: [
            { id: 'build', run: 'docker build -t app .' },
            {
              id: 'bpa',
              uses: 'docker/build-push-action@v6',
              with: { load: true, tags: '${{ github.sha }}' },
            },
            { id: 'meta', uses: 'docker/metadata-action@v5' },
            {
              run: [
                'docker run ${{ steps.build.outputs.image }}',
                'docker run "${{steps.bpa.outputs.digest}}"',
                'docker run ${{ steps.meta.outputs.image }}',
                'docker run ${{ steps.missing.outputs.image }}',
                'docker run x-${{ steps.build.outputs.image }}',
              ].join('\n'),
            },
          ],
        },
      },
    }
    expect(check(doc).map((v) => v.split(' must')[0])).toEqual([
      'j: ${{ steps.meta.outputs.image }}',
      'j: ${{ steps.missing.outputs.image }}',
      'j: x-${{ steps.build.outputs.image }}',
    ])
  })

  it('skips tags containing an expression or variable', () => {
    const doc: Document = {
      jobs: {
        j: {
          steps: [
            { run: 'docker build -t app:${{ github.sha }} .' },
            { run: 'docker build -t "app:$TAG" .' },
            { run: 'docker run app:${{ github.sha }}\ndocker run "app:$TAG"' },
          ],
        },
      },
    }
    expect(check(doc)).toHaveLength(2)
  })

  it('leaves the Docker Hub default check unchanged without a policy', () => {
    const doc: Document = {
      jobs: {
        j: {
          steps: [
            { id: 'b', run: 'docker build -t app:ci .' },
            { run: 'docker run app:ci\ndocker run ${{ steps.b.outputs.image }}' },
          ],
        },
      },
    }
    expect(check(doc, {})).toEqual(['j: app:ci must come from mirror.gcr.io/'])
    expect(check(doc, { allowRegistries: [] })).toEqual(['j: app:ci must come from mirror.gcr.io/'])
  })

  describe('across files', () => {
    const roots: string[] = []
    afterEach(() => {
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
    })

    it('does not count a tag built in a different file', () => {
      const root = mkdtempSync(join(tmpdir(), 'docker-mirror-builds-'))
      roots.push(root)
      const files = {
        '.github/workflows/build.yml':
          'jobs:\n  j:\n    steps:\n      - run: docker build -t app:ci .\n      - run: docker run app:ci\n',
        '.github/workflows/use.yml': 'jobs:\n  j:\n    steps:\n      - run: docker run app:ci\n',
      }
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), content)
      }
      expect(checkDockerImageMirrors(root, Object.keys(files), strict)).toEqual([
        `.github/workflows/use.yml#j: app:ci ${rejected('', 'app:ci').split(': app:ci ')[1]}`,
      ])
    })
  })
})
