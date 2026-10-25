import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  assertNoUnsupportedTrivyAction,
  assertNoUnsupportedTrivyShellSource,
  checkTrivyPolicy,
  isShellPolicySource,
  trivyPackageScanCommands,
} from './index.mts'

const gate = (extra = '') =>
  `trivy image --scanners vuln --quiet --skip-db-update --pkg-types os --exit-code "$TRIVY_FINDINGS_EXIT_CODE" --severity CRITICAL,HIGH --ignore-unfixed --ignorefile .trivyignore.yaml --format table --table-mode detailed --output report.txt ${extra}target`
const sbom =
  'trivy image --quiet --skip-db-update --exit-code 0 --format cyclonedx --output s.json t'
const workflow = (...runs: string[]) =>
  `jobs:\n  scan:\n    steps:\n${runs.map((run) => `      - run: ${JSON.stringify(run)}\n`).join('')}`
const registry = (days = 14) => {
  const expiry = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
  return `vulnerabilities:\n  - id: CVE-1\n    purls: [pkg:deb/debian/curl@8.0.1-1]\n    statement: "Not exploitable: unused. Cleanup: https://github.com/a/b/issues/3"\n    expired_at: ${expiry}\n`
}

const roots: string[] = []
function repo(files: Record<string, string>): { root: string; tracked: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'trivy-policy-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return { root, tracked: Object.keys(files) }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const compliant = {
  '.github/workflows/build.yml': workflow(gate(), sbom, gate('other-'), sbom),
  '.trivyignore.yaml': registry(),
}
const check = (files: Record<string, string>, options = {}, extra: string[] = []) => {
  const { root, tracked } = repo(files)
  return checkTrivyPolicy(root, [...tracked, ...extra], options)
}

describe('checkTrivyPolicy', () => {
  it('accepts compliant workflows and a valid registry', () => {
    expect(check(compliant)).toEqual([])
  })

  it('collects every violation instead of stopping at the first', () => {
    const violations = check({
      '.github/workflows/build.yml': workflow(gate().replace('--quiet', ''), sbom, gate(), sbom),
      '.trivyignore.yaml': registry(90),
    })
    expect(violations).toEqual([
      'Trivy vulnerability scan must include --quiet',
      'vulnerabilities[0].expired_at must be no more than 30 days away',
    ])
  })

  it('requires enough gates and SBOMs, with configurable minimums', () => {
    const files = { ...compliant, '.github/workflows/build.yml': workflow(gate(), sbom) }
    expect(check(files)).toEqual(['Trivy policy requires OS gates and unfiltered component SBOMs'])
    expect(check(files, { minGates: 1, minSboms: 1 })).toEqual([])
    expect(check({ '.trivyignore.yaml': registry() }, { minGates: 0, minSboms: 0 })).toEqual([])
  })

  it('enforces the configured cleanup URL prefix', () => {
    expect(check(compliant, { cleanupUrlPrefix: 'https://github.com/a/b/issues/' })).toEqual([])
    expect(check(compliant, { cleanupUrlPrefix: 'https://github.com/other/repo/issues/' })).toEqual(
      [expect.stringContaining('cleanup issue URL')],
    )
  })

  it('does not count database-only downloads as gates', () => {
    expect(
      check({
        ...compliant,
        '.github/workflows/build.yml': workflow(
          'trivy image --download-db-only',
          gate(),
          sbom,
          gate('other-'),
          sbom,
        ),
      }),
    ).toEqual([])
  })

  it('requires a tracked registry and reports an unreadable or malformed one', () => {
    const { '.trivyignore.yaml': _, ...withoutRegistry } = compliant
    expect(check(withoutRegistry)).toEqual(['Trivy exception registry must be tracked'])
    expect(check(withoutRegistry, {}, ['.trivyignore.yaml'])).toEqual([
      expect.stringContaining('ENOENT'),
    ])
    expect(check({ ...compliant, '.trivyignore.yaml': 'vulnerabilities: nope' })).toEqual([
      'vulnerabilities must be an array',
    ])
  })

  it('uses the configured ignore file and exit-code variable', () => {
    const files = {
      '.github/workflows/build.yml': workflow(
        ...[gate(), sbom, gate(), sbom].map((run) =>
          run.replace('.trivyignore.yaml', 'ci/ignore.yaml').replace('TRIVY_FINDINGS', 'FINDINGS'),
        ),
      ),
      'ci/ignore.yaml': registry(),
    }
    const options = { ignoreFile: 'ci/ignore.yaml', findingsExitCodeEnv: 'FINDINGS_EXIT_CODE' }
    expect(check(files, options)).toEqual([])
    expect(check(files)).toContain('Trivy exception registry must be tracked')
  })

  it('reports unsupported scans before judging flags', () => {
    expect(
      check({ ...compliant, '.github/workflows/build.yml': workflow('bash -c "trivy image x"') }),
    ).toEqual([expect.stringContaining('unsupported indirect Trivy execution')])
    expect(check({ ...compliant }, {}, []).length).toBe(0)
    expect(check({ ...compliant }, {}, []).length).toBe(0)
  })
})

describe('trivyPackageScanCommands', () => {
  it('reads workflows and composite actions, skipping missing and unrelated files', () => {
    const { root } = repo({
      '.github/workflows/a.yaml': workflow('trivy image a'),
      '.github/actions/x/y/action.yml':
        'runs:\n  using: composite\n  steps:\n    - run: trivy fs b\n',
      '.github/workflows/empty.yml': '',
      '.github/workflows/no-steps.yml': 'jobs:\n  j: {}\n',
      'notes.yml': workflow('trivy image ignored'),
    })
    expect(
      trivyPackageScanCommands(
        [
          '.github/workflows/a.yaml',
          '.github/actions/x/y/action.yml',
          '.github/workflows/empty.yml',
          '.github/workflows/no-steps.yml',
          '.github/workflows/deleted.yml',
          'notes.yml',
          'deleted-but-indexed.sh',
        ],
        root,
      ),
    ).toEqual(['trivy image a', 'trivy fs b'])
    expect(trivyPackageScanCommands([], root)).toEqual([])
  })

  it('ignores steps without a run string and rejects trivy actions', () => {
    const files = {
      '.github/workflows/a.yml':
        'jobs:\n  j:\n    steps:\n      - run: 5\n      - uses: actions/checkout@v4\n',
    }
    const { root, tracked } = repo(files)
    expect(trivyPackageScanCommands(tracked, root)).toEqual([])
    const bad = repo({
      '.github/workflows/a.yml':
        'jobs:\n  j:\n    steps:\n      - uses: aquasecurity/trivy-action@v1\n',
    })
    expect(() => trivyPackageScanCommands(bad.tracked, bad.root)).toThrow(
      '.github/workflows/a.yml: unsupported Trivy action aquasecurity/trivy-action@v1',
    )
  })

  it('rejects package scans in shell scripts but allows database downloads', () => {
    const { root } = repo({
      'ci/scan.sh': 'trivy image target\n',
      'ci/prepare': '#!/usr/bin/env bash\ntrivy image --download-db-only\n',
      'ci/bad': '#!/bin/sh\ntrivy fs .\n',
    })
    expect(trivyPackageScanCommands(['ci/prepare'], root)).toEqual([])
    chmodSync(join(root, 'ci/prepare'), 0o755)
    chmodSync(join(root, 'ci/bad'), 0o755)
    expect(trivyPackageScanCommands(['ci/prepare'], root)).toEqual([])
    expect(() => trivyPackageScanCommands(['ci/scan.sh'], root)).toThrow(
      'ci/scan.sh: unsupported Trivy shell-script scan',
    )
    expect(() => trivyPackageScanCommands(['ci/bad'], root)).toThrow('ci/bad: unsupported')
  })
})

describe('shell source detection', () => {
  it('recognizes shell extensions and executable shebangs only', () => {
    const { root } = repo({
      'a.zsh': '',
      run: '#!/usr/bin/env -S bash -e\n',
      plain: '#!/usr/bin/env node\n',
      'data.json': '{}',
      locked: '#!/bin/bash\n',
    })
    for (const name of ['run', 'plain', 'data.json']) chmodSync(join(root, name), 0o755)
    chmodSync(join(root, 'locked'), 0o644)
    expect(isShellPolicySource('a.zsh')).toBe(true)
    expect(isShellPolicySource(join(root, 'run'))).toBe(true)
    for (const name of ['plain', 'data.json', 'locked', 'missing'])
      expect(isShellPolicySource(join(root, name))).toBe(false)
  })

  it('exposes the fixture-level assertions', () => {
    expect(() => assertNoUnsupportedTrivyAction('aquasecurity/trivy-action')).toThrow(
      'fixture: unsupported Trivy action',
    )
    expect(() => assertNoUnsupportedTrivyAction(undefined)).not.toThrow()
    expect(() => assertNoUnsupportedTrivyShellSource('trivy --version', 'x.sh')).not.toThrow()
    for (const flag of ['--download-db-only=false', '--download-db-only --download-db-only'])
      expect(() =>
        assertNoUnsupportedTrivyShellSource(`trivy image ${flag} target`, 'x.sh'),
      ).toThrow('x.sh: unsupported Trivy shell-script scan')
    expect(() =>
      assertNoUnsupportedTrivyShellSource('trivy image --download-db-only', 'x.sh'),
    ).not.toThrow()
    expect(() =>
      assertNoUnsupportedTrivyShellSource('trivy image t; trivy image --download-db-only', 'x.sh'),
    ).toThrow('x.sh: unsupported')
  })
})
