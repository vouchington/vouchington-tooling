import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

import { dockerfileViolations, workflowImageViolations, type Document } from './index.mts'
import { collectLocalBuilds } from './local-builds.mts'
import { lastAssignment, normalizeText, stepEnv, variableName } from './shell-vars.mts'

const strict = { allowRegistries: ['ghcr.io/vouchington/dependency-'], requireDigest: true }
const violations = (yaml: string, policy = strict) =>
  workflowImageViolations('f.yml', parse(yaml) as Document, undefined, policy).map(
    (v) => v.replace('f.yml#', '').split(' must')[0]!,
  )
const short = (yaml: string) => violations(yaml).map((v) => v.replace('composite: ', ''))

// Trimmed from the build-backend-images and build-web-images composite actions: images are built
// by metadata-action plus bake-action / build-push-action, then smoke-tested through IMAGE.
const backend = `
runs:
  using: composite
  steps:
    - id: meta-api
      uses: docker/metadata-action@v6
      with:
        images: \${{ env.IMAGE_REPOSITORY }}/api
        bake-target: api
    - id: meta-worker-cpu
      uses: docker/metadata-action@v6
      with:
        images: \${{ env.IMAGE_REPOSITORY }}/worker-cpu
    - id: meta-worker-io
      uses: docker/metadata-action@v6
      with:
        images: \${{ env.IMAGE_REPOSITORY }}/worker-io
    - id: bake
      uses: docker/bake-action@v7
      with:
        files: |
          ./docker-bake.hcl
          \${{ steps.meta-api.outputs.bake-file }}
          \${{ steps.meta-worker-cpu.outputs.bake-file }}
          \${{ steps.meta-worker-io.outputs.bake-file }}
    - shell: bash
      env:
        IMAGE_TAG: \${{ env.SHA_TAG }}
      run: |
        set -euo pipefail
        IMAGE="$IMAGE_REPOSITORY/api:$IMAGE_TAG"
        docker run -d --name "$C" --network host \\
          -e NODE_ENV=test \\
          "$IMAGE"
        DIAGNOSTIC_OUTPUT=$(docker run --rm --network host \\
          -e X \\
          "$IMAGE" valkey-admin.mts diagnose)
    - shell: bash
      env:
        IMAGE_TAG: \${{ env.SHA_TAG }}
      run: |
        IMAGE="$IMAGE_REPOSITORY/worker-cpu:$IMAGE_TAG"
        docker run -d --name "$C" --network host \\
          "$IMAGE"
    - shell: bash
      env:
        IMAGE_TAG: \${{ env.SHA_TAG }}
      run: |
        IMAGE="$IMAGE_REPOSITORY/worker-io:$IMAGE_TAG"
        Q=$(docker run --rm --entrypoint /nodejs/bin/node "$IMAGE" -e 'x')
        docker run -d --name "$C" --network host \\
          "$IMAGE"
`
const web = `
runs:
  using: composite
  steps:
    - id: meta
      uses: docker/metadata-action@v6
      with:
        images: \${{ env.IMAGE_REPOSITORY }}/web
        tags: |
          type=sha,prefix=sha-,format=long
    - uses: docker/build-push-action@v7
      with:
        load: true
        push: false
        tags: \${{ steps.meta.outputs.tags }}
    - shell: bash
      env:
        IMAGE_TAG: \${{ env.SHA_TAG }}
      run: |
        IMAGE="$IMAGE_REPOSITORY/web:$IMAGE_TAG"
        CONTAINER=$(docker run -d -p "$PORT:3000" --add-host=host.docker.internal:host-gateway \\
          -e AWS_REGION "$IMAGE")
`
const snapshot = `
jobs:
  generate:
    services:
      postgres:
        image: \${{ needs.prepare.outputs.postgres_image }}
`
const built = '    - run: docker build -t app:ci .\n'
const stepsOf = (run: string, extra = '') => `
runs:
  steps:
${extra}    - run: |
${run
  .split('\n')
  .map((line) => `        ${line}`)
  .join('\n')}
`

describe('real action shapes', () => {
  it('accepts the seven references from the report', () => {
    expect(violations(backend)).toEqual([])
    expect(violations(web)).toEqual([])
    const expression = '${{ needs.prepare.outputs.postgres_image }}'
    expect(violations(snapshot)).toEqual([`generate service postgres: ${expression}`])
    expect(
      workflowImageViolations('f.yml', parse(snapshot) as Document, undefined, {
        ...strict,
        allowRefExpressions: [expression],
      }),
    ).toEqual([])
  })

  it('still flags them when the build steps are absent', () => {
    const without = (yaml: string) => short(yaml.replace(/uses: docker\/\S+/gu, 'uses: x/y'))
    expect(without(backend)).toEqual(Array(5).fill('"$IMAGE"'))
    expect(without(web)).toEqual(['"$IMAGE"'])
  })
})

describe('shell variable resolution', () => {
  it('resolves $VAR, "$VAR" and ${VAR} through an earlier assignment, last one winning', () => {
    const run = [
      'IMAGE=evil:1',
      'export IMAGE=app:ci',
      'docker run $IMAGE',
      'docker run "$IMAGE"',
      'docker run ${IMAGE}',
    ].join('\n')
    expect(violations(stepsOf(run, built))).toEqual([])
    const reassigned = ['IMAGE=app:ci', 'IMAGE=evil:1', 'docker run "$IMAGE"'].join('\n')
    expect(short(stepsOf(reassigned, built))).toEqual(['"$IMAGE"'])
  })

  it('rejects an unrelated variable, a later assignment, and another run block', () => {
    expect(short(stepsOf('IMAGE=app:ci\ndocker run "$OTHER"', built))).toEqual(['"$OTHER"'])
    expect(short(stepsOf('docker run "$IMAGE"\nIMAGE=app:ci', built))).toEqual(['"$IMAGE"'])
    const split = `
runs:
  steps:
    - run: docker build -t app:ci .
    - run: IMAGE=app:ci
    - run: docker run "$IMAGE"
`
    expect(short(split)).toEqual(['"$IMAGE"'])
  })

  it('does not resolve a command-substituted assignment', () => {
    expect(short(stepsOf('IMAGE=$(pick)\ndocker run "$IMAGE"', built))).toEqual(['"$IMAGE"'])
  })
})

describe('variable build tags', () => {
  it('matches normalized tag text exactly and rejects near misses', () => {
    const build = '    - run: docker build -t "app:${TAG}" -t "$REPO/x:$TAG" .\n'
    const run = [
      'docker run app:$TAG',
      'docker run "$REPO/x:${TAG}"',
      'docker run app:$TAGS',
      'docker run app:${{ env.TAG }}',
      'docker run $REPO/x:$TAG2',
    ].join('\n')
    expect(short(stepsOf(run, build))).toEqual(['app:$TAGS', '$REPO/x:$TAG2'])
  })

  it('maps step env inputs to the variable the run block uses, in either direction', () => {
    const doc = `
runs:
  steps:
    - env:
        REPO: \${{ inputs.repo }}
      run: docker build -t "\${{ inputs.repo }}/app:ci" .
    - env:
        REPO: \${{ inputs.repo }}
      run: |
        IMAGE="$REPO/app:ci"
        docker run "$IMAGE"
        docker run "\${{ inputs.repo }}/app:ci"
        docker run "$REPO/app:other"
`
    expect(short(doc)).toEqual(['"$REPO/app:other"'])
    const reverse = `
runs:
  steps:
    - env:
        REPO: \${{ inputs.repo }}
      run: docker build -t "$REPO/app:ci" .
    - run: docker run "\${{ inputs.repo }}/app:ci"
`
    expect(violations(reverse)).toEqual([])
  })

  it('skips tags that are only a variable and metadata names no build consumes', () => {
    const doc = `
runs:
  steps:
    - run: docker build -t "$IMG" -t '\${{ inputs.tag }}' .
    - id: meta
      uses: docker/metadata-action@v6
      with:
        images: ghcr.io/o/unbuilt
    - uses: docker/build-push-action@v7
      with:
        push: true
        tags: \${{ steps.meta.outputs.tags }}
    - run: |
        docker run "$IMG"
        docker run ghcr.io/o/unbuilt:1
        docker run \${{ inputs.tag }}
`
    expect(short(doc)).toEqual(['"$IMG"', 'ghcr.io/o/unbuilt:1', '${{ inputs.tag }}'])
  })

  it('does not exempt a digest-pinned or sibling repository reference', () => {
    const doc = `
runs:
  steps:
    - id: meta
      uses: docker/metadata-action@v6
      with:
        images: ghcr.io/o/app, ghcr.io/o/side
    - uses: docker/bake-action@v7
      with:
        files: \${{ steps.meta.outputs.bake-file }}
    - run: |
        docker run ghcr.io/o/app:$TAG
        docker run ghcr.io/o/app
        docker run ghcr.io/o/app@sha256:\${DIGEST}
        docker run ghcr.io/o/apple:$TAG
        docker run ghcr.io/o/app/sub:$TAG
`
    expect(short(doc)).toEqual([
      'ghcr.io/o/app@sha256:${DIGEST}',
      'ghcr.io/o/apple:$TAG',
      'ghcr.io/o/app/sub:$TAG',
    ])
  })
})

describe('the Dockerfile tag stays rejected', () => {
  it('flags a distroless-style tagged FROM', () => {
    const from = 'FROM gcr.io/distroless/nodejs26-debian13:nonroot\n'
    expect(dockerfileViolations('Dockerfile', from, strict)).toEqual([
      'Dockerfile: FROM gcr.io/distroless/nodejs26-debian13:nonroot must start with "ghcr.io/vouchington/dependency-"; must be pinned with @sha256:<64 lowercase hex characters>',
    ])
  })
})

describe('helpers', () => {
  it('normalizes text and variable names', () => {
    const env = stepEnv({
      env: { A: '${{ inputs.a }}', B: 3, C: "'x'", D: 'd' },
      run: 'echo x; D=2',
    })
    expect([...env]).toEqual([
      ['A', '${{ inputs.a }}'],
      ['B', '3'],
      ['C', 'x'],
    ])
    expect(stepEnv({}).size).toBe(0)
    expect(normalizeText('"${{ inputs.a }}"/${B}/${{env.C}}/${{ x.y }}/$D', env)).toBe(
      '${{ inputs.a }}/3/x/${{ x.y }}/$D',
    )
    expect(variableName("'$X'")).toBeUndefined()
    expect(variableName('${X}')).toBe('X')
    expect(variableName('$X/y')).toBeUndefined()
    expect(lastAssignment('A=1\nlocal A="2 3"\nAB=4', 'A')).toBe('"2 3"')
    expect(lastAssignment('echo A=1', 'A')).toBeUndefined()
    expect(lastAssignment('A="x"-y', 'A')).toBe('"x"-y')
    expect(lastAssignment('A=1\nA=2 cmd', 'A')).toBe('1')
    expect(lastAssignment('A=1\nif t; then\n  A=2\nfi', 'A')).toBeUndefined()
    expect(lastAssignment('f() {\nA=1\n}\nA=2', 'A')).toBe('2')
    expect(lastAssignment('f() {\nA=1\n}', 'A')).toBeUndefined()
  })

  it('records metadata repositories only for build steps that consume them', () => {
    const { repositories, stepIds } = collectLocalBuilds([
      { id: 'm', uses: 'docker/metadata-action@v6', with: { images: 7 } },
      { id: 'n', uses: 'docker/metadata-action@v6', with: { images: '$X,a/b' } },
      {
        id: 'bake',
        uses: 'docker/bake-action@v7',
        with: { files: '${{ steps.n.outputs.bake-file }}' },
      },
    ])
    expect([...repositories]).toEqual(['a/b'])
    expect([...stepIds]).toEqual(['bake'])
  })
})

describe('review hardening', () => {
  const metaBuild = (extra: string) => `
runs:
  steps:
    - id: meta
      uses: docker/metadata-action@v6
      with:
        images: ghcr.io/o/app
${extra}
    - run: docker run ghcr.io/o/app:$TAG
`
  it('does not equate a variable bound to different step values', () => {
    const doc = `
runs:
  steps:
    - env:
        TAG: built
      run: docker build -t app:$TAG .
    - env:
        TAG: unbuilt
      run: docker run app:$TAG
    - env:
        TAG: built
      run: docker run app:$TAG
`
    expect(short(doc)).toEqual(['app:$TAG'])
  })

  it('requires the metadata outputs to feed the build tags or bake files', () => {
    const labels = `    - uses: docker/build-push-action@v7
      with:
        load: true
        tags: app:ci
        labels: \${{ steps.meta.outputs.labels }}
`
    expect(short(metaBuild(labels))).toEqual(['ghcr.io/o/app:$TAG'])
    const tags = labels.replace('tags: app:ci', 'tags: ${{ steps.meta.outputs.tags }}')
    expect(short(metaBuild(tags))).toEqual([])
  })

  it('requires a bake step to export to the local image store', () => {
    const bake = (with_: string) => `    - uses: docker/bake-action@v7
      with:
        files: \${{ steps.meta.outputs.bake-file }}
${with_}`
    expect(short(metaBuild(bake('')))).toEqual([])
    expect(short(metaBuild(bake('        set: "*.output=type=docker"\n')))).toEqual([])
    for (const extra of [
      '        set: "*.output=type=cacheonly"\n',
      '        load: false\n',
      '        push: true\n',
    ]) {
      expect(short(metaBuild(bake(extra)))).toEqual(['ghcr.io/o/app:$TAG'])
    }
  })

  it('keeps braces before a word character and ignores subshell and function assignments', () => {
    const doc = `
runs:
  steps:
    - env:
        TAG: ci
        TAG1: external
      run: docker build -t app:\${TAG}1 .
    - env:
        TAG: ci
        TAG1: external
      run: docker run app:$TAG1
`
    expect(short(doc)).toEqual(['app:$TAG1'])
    const subshell = 'IMAGE=ext:1\n(\nIMAGE=app:ci\n)\ndocker run "$IMAGE"'
    expect(short(stepsOf(subshell, built))).toEqual(['"$IMAGE"'])
    const fn = 'IMAGE=ext:1\nset_it() {\nIMAGE=app:ci\n}\ndocker run "$IMAGE"'
    expect(short(stepsOf(fn, built))).toEqual(['"$IMAGE"'])
  })

  it('does not trust command-local assignments or step env the script overwrites', () => {
    const local = 'IMAGE=ext:1\nIMAGE=app:ci true\ndocker run "$IMAGE"'
    expect(short(stepsOf(local, built))).toEqual(['"$IMAGE"'])
    const doc = `
runs:
  steps:
    - run: docker build -t app:ci .
    - env:
        TAG: ci
      run: |
        TAG=external
        docker run app:$TAG
`
    expect(short(doc)).toEqual(['app:$TAG'])
  })

  it('takes the whole assignment word, skips branch assignments, and ignores single quotes', () => {
    expect(short(stepsOf('IMAGE="app:ci"-external\ndocker run "$IMAGE"', built))).toEqual([
      '"$IMAGE"',
    ])
    const branch = 'IMAGE=ext:1\nif false; then\n  IMAGE=app:ci\nfi\ndocker run "$IMAGE"'
    expect(short(stepsOf(branch, built))).toEqual(['"$IMAGE"'])
    expect(short(stepsOf("IMAGE=app:ci\ndocker run '$IMAGE'", built))).toEqual(["'$IMAGE'"])
  })
})
