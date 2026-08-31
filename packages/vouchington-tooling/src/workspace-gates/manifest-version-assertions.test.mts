import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkManifestDependencyVersionAssertions } from './manifest-version-assertions.mts'
import { buildContextFromTrackedFiles } from '../shared-context/index.mts'

const roots: string[] = []

function dependencyAssertion(
  field: string,
  matcher: 'toBe' | 'toEqual' | 'toStrictEqual' = 'toBe',
): string {
  return [
    'expect(manifest',
    `.${field}`,
    "['example-dependency']",
    `).${matcher}(`,
    "'^1.2.3'",
    ')',
  ].join('')
}

function dependencyMapAssertion(field: string, name = 'example-dependency'): string {
  return ["expect(readManifest('app')", `.${field}`, ').toEqual({ ', `'${name}': '^1.2.3' })`].join(
    '',
  )
}

function packageSpecAssertion(): string {
  return ['expect(config.args).toEqual([', "'example-dependency@1.2.3'", '])'].join('')
}

function templatePackageSpecAssertion(): string {
  return ['expect(config.args).toContain(', '`example-dependency@1.2.3`', ')'].join('')
}

function entriesAssertion(): string {
  return [
    'expect(Object.entries(manifest.dependencies)).not.toEqual([',
    "['example-dependency', '^1.2.3']",
    '])',
  ].join('')
}

function propertyVersionAssertion(): string {
  return [
    'expect(manifest.dependencies)',
    "  .toHaveProperty('example-dependency', '^1.2.3')",
  ].join('\n')
}

async function checkFiles(files: Record<string, string>): Promise<string[]> {
  const root = await mkdtemp(join(tmpdir(), 'manifest-version-assertions-'))
  roots.push(root)
  const tracked = {
    'package.json': JSON.stringify({
      dependencies: { 'example-dependency': '^1.2.3' },
      peerDependencies: { 'example-peer': '^1.2.3' },
    }),
    ...files,
  }
  for (const [file, source] of Object.entries(tracked)) {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), source)
  }
  const errors: string[] = []
  checkManifestDependencyVersionAssertions(
    buildContextFromTrackedFiles(root, Object.keys(tracked)),
    errors,
  )
  return errors
}

describe('manifest dependency version assertions', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
  })

  it('rejects exact SemVer assertions through every package dependency field', async () => {
    const source = [
      dependencyAssertion('dependencies'),
      dependencyAssertion('devDependencies', 'toEqual'),
      dependencyAssertion('optionalDependencies', 'toStrictEqual'),
      dependencyAssertion('peerDependencies'),
    ].join('\n')

    const errors = await checkFiles({
      'test/manifest.test.mts': [
        source,
        dependencyMapAssertion('dependencies'),
        dependencyMapAssertion('peerDependencies', 'example-peer'),
        entriesAssertion(),
        propertyVersionAssertion(),
      ].join('\n'),
      'test/config.test.mts': packageSpecAssertion(),
      'test/template.test.mts': templatePackageSpecAssertion(),
    })

    expect(errors).toHaveLength(10)
    expect(errors.every((error) => error.includes('must not assert the exact version'))).toBe(true)
  })

  it('allows dependency membership, non-manifest versions, and synthetic fixture package specs', async () => {
    const errors = await checkFiles({
      'test/allowed.test.mts': [
        "expect(manifest.dependencies).toHaveProperty('example-dependency')",
        "expect(manifest.version).toBe('1.2.3')",
      ].join('\n'),
      'src/ignored.mts': dependencyAssertion('dependencies'),
      'test/fixtures/package.json': JSON.stringify({ dependencies: { synthetic: '^1.2.3' } }),
      'test/synthetic.test.mts': [
        'expect(manifest.dependencies',
        "['synthetic']).toBe('^1.2.3')",
      ].join(''),
      'docs/README.md': 'npm install example-dependency@1.2.3',
      'test/comment.test.mts':
        "// expect(manifest.dependencies['example-dependency']).toBe('^1.2.3')",
    })

    expect(errors).toEqual([])
  })

  it('reports a tracked test source that cannot be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manifest-version-assertions-'))
    roots.push(root)
    const errors: string[] = []

    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { 'example-dependency': '^1.2.3' } }),
    )
    checkManifestDependencyVersionAssertions(
      buildContextFromTrackedFiles(root, ['package.json', 'test/missing.test.mts']),
      errors,
    )

    expect(errors).toEqual([
      expect.stringContaining(
        'failed to read test source for manifest dependency version assertions',
      ),
    ])
  })

  it('skips malformed manifests and reports unreadable tracked sources without a context reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manifest-version-assertions-'))
    roots.push(root)
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { 'example-dependency': '^1.2.3' } }),
    )
    await mkdir(join(root, 'broken'), { recursive: true })
    await writeFile(join(root, 'broken/package.json'), '{')
    await mkdir(join(root, 'scalar'), { recursive: true })
    await writeFile(join(root, 'scalar/package.json'), '[]')
    const errors: string[] = []

    checkManifestDependencyVersionAssertions(
      {
        isInsideGitRepo: true,
        repoRoot: root,
        trackedFiles: [
          'package.json',
          'broken/package.json',
          'scalar/package.json',
          'missing/package.json',
          'test/missing.test.mts',
        ],
        trackedFileSet: new Set([
          'package.json',
          'broken/package.json',
          'scalar/package.json',
          'missing/package.json',
          'test/missing.test.mts',
        ]),
      },
      errors,
    )

    expect(errors).toEqual([
      expect.stringContaining(
        'failed to read test source for manifest dependency version assertions',
      ),
    ])
  })

  it('does not inspect tests when no non-fixture manifest declares dependencies', () => {
    const errors: string[] = []
    checkManifestDependencyVersionAssertions(
      {
        isInsideGitRepo: true,
        repoRoot: 'unused',
        trackedFiles: ['test/fixture.test.mts'],
        trackedFileSet: new Set(['test/fixture.test.mts']),
        readTrackedFile: () => "expect(manifest.dependencies).toBe('^1.2.3')",
      },
      errors,
    )
    expect(errors).toEqual([])
  })
})
