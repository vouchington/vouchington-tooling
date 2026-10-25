import { describe, expect, it } from 'vitest'

import {
  assertUnfilteredComponentSbom,
  assertVulnerabilityGate,
  isComponentSbomGeneration,
} from './index.mts'

const complete =
  'trivy filesystem --scanners vuln --quiet --skip-db-update --pkg-types os --exit-code "$TRIVY_FINDINGS_EXIT_CODE" --severity CRITICAL,HIGH --ignore-unfixed --ignorefile .trivyignore.yaml --format table --table-mode detailed --output report.txt rootfs'
const sbom =
  'trivy image --quiet --skip-db-update --exit-code 0 --format cyclonedx --output sbom.cdx.json rootfs'
const missing = (flag: string) => `Trivy vulnerability scan must include ${flag}`

describe('assertVulnerabilityGate', () => {
  it('accepts a complete gate and ignores arguments after --', () => {
    expect(() => assertVulnerabilityGate(complete)).not.toThrow()
    expect(() => assertVulnerabilityGate(`${complete} -- --target`)).not.toThrow()
    expect(() =>
      assertVulnerabilityGate(
        `${complete.replace('--scanners vuln ', '')} -- --scanners vuln --severity CRITICAL,HIGH`,
      ),
    ).toThrow(missing('--scanners vuln'))
  })

  it('ignores flags that only appear in a comment', () => {
    expect(() =>
      assertVulnerabilityGate(`${complete.replace('--scanners vuln ', '')} # --scanners vuln`),
    ).toThrow(missing('--scanners vuln'))
  })

  it('rejects widened or malformed values', () => {
    for (const [needle, replacement, message] of [
      ['--severity CRITICAL,HIGH', '', '--severity CRITICAL,HIGH'],
      ['--severity CRITICAL,HIGH', '--severity CRITICAL,CRITICAL', '--severity CRITICAL,HIGH'],
      ['--scanners vuln', '--scanners vuln,secret', '--scanners vuln'],
      ['--pkg-types os', '--pkg-types os,library', '--pkg-types os'],
      ['--severity CRITICAL,HIGH', '--severity CRITICAL,HIGH,MEDIUM', '--severity CRITICAL,HIGH'],
      ['--ignore-unfixed', '--ignore-unfixed=false', '--ignore-unfixed'],
      ['--output report.txt', '--output=', '--output <file>'],
      ['--output report.txt', '', '--output <file>'],
      ['--format table', '--format json', '--format table'],
      ['--table-mode detailed', '--table-mode compact', '--table-mode detailed'],
      [
        '--ignorefile .trivyignore.yaml',
        '--ignorefile other.yaml',
        '--ignorefile .trivyignore.yaml',
      ],
      [
        '--exit-code "$TRIVY_FINDINGS_EXIT_CODE"',
        '--exit-code 1',
        '--exit-code "$TRIVY_FINDINGS_EXIT_CODE"',
      ],
      ['--exit-code "$TRIVY_FINDINGS_EXIT_CODE"', '', '--exit-code "$TRIVY_FINDINGS_EXIT_CODE"'],
    ] as const) {
      expect(() => assertVulnerabilityGate(complete.replace(needle, replacement))).toThrow(
        missing(message),
      )
    }
  })

  it('accepts quoted fragments inside a flag word', () => {
    const quoted = complete
      .replace('--scanners vuln', '--scanners="vuln"')
      .replace('--format table', "--format='table'")
    expect(() => assertVulnerabilityGate(quoted)).not.toThrow()
    expect(
      isComponentSbomGeneration(sbom.replace('--format cyclonedx', '--format="cyclonedx"')),
    ).toBe(true)
  })

  it('requires bare boolean flags exactly once', () => {
    for (const replacement of ['', '--skip-db-update=false', '--skip-db-update --skip-db-update'])
      expect(() =>
        assertVulnerabilityGate(complete.replace('--skip-db-update', replacement)),
      ).toThrow(missing('--skip-db-update'))
    for (const flag of ['--quiet', '--ignore-unfixed'])
      for (const value of ['true', 'False', '0'])
        expect(() => assertVulnerabilityGate(complete.replace(flag, `${flag}=${value}`))).toThrow(
          missing(flag),
        )
    expect(() =>
      assertVulnerabilityGate(complete.replace('--quiet', '--quiet --quiet=false')),
    ).toThrow(missing('--quiet'))
    expect(() => assertVulnerabilityGate(complete.replace('--quiet', '--quiet false'))).toThrow(
      missing('--quiet'),
    )
  })

  it('rejects options outside the allowed set', () => {
    for (const option of ['--ignore-status', '--skip-files x', '--skip-dirs x', '--unknown'])
      expect(() => assertVulnerabilityGate(`${complete} ${option}`)).toThrow(
        `Trivy vulnerability scan must not include ${option.split(' ')[0]}`,
      )
    expect(() => assertVulnerabilityGate(`${complete} -s LOW`)).toThrow(
      'Trivy vulnerability scan must not include -s',
    )
  })

  it('takes the ignore file and exit-code variable from options', () => {
    const custom = complete
      .replace('.trivyignore.yaml', 'ci/ignore.yaml')
      .replace('TRIVY_FINDINGS_EXIT_CODE', 'FINDINGS')
    const options = { ignoreFile: 'ci/ignore.yaml', findingsExitCodeEnv: 'FINDINGS' }
    expect(() => assertVulnerabilityGate(custom, options)).not.toThrow()
    expect(() => assertVulnerabilityGate(custom, { findingsExitCodeEnv: 'FINDINGS' })).toThrow(
      missing('--ignorefile .trivyignore.yaml'),
    )
    expect(() => assertVulnerabilityGate(complete, options)).toThrow(
      missing('--exit-code "$FINDINGS"'),
    )
  })
})

describe('component SBOM scans', () => {
  it('classifies cyclonedx output that is not an sbom subcommand', () => {
    expect(isComponentSbomGeneration(sbom)).toBe(true)
    expect(isComponentSbomGeneration('trivy sbom --format cyclonedx in.json')).toBe(false)
    expect(isComponentSbomGeneration(complete)).toBe(false)
  })

  it('accepts an unfiltered scan', () => {
    expect(() => assertUnfilteredComponentSbom(sbom)).not.toThrow()
  })

  it('rejects filters, unknown options and short flags', () => {
    for (const argument of [
      '--scanners vuln',
      '--pkg-types=os',
      '--severity HIGH',
      '--ignore-unfixed true',
      '--ignorefile=.trivyignore.yaml',
      '--unknown',
      '-q',
    ])
      expect(() => assertUnfilteredComponentSbom(`${sbom} ${argument}`)).toThrow(
        `Trivy CycloneDX SBOM must not include ${argument.split(/[ =]/)[0]}`,
      )
  })

  it('requires each fixed argument', () => {
    for (const [needle, message] of [
      ['--quiet', '--quiet'],
      ['--skip-db-update', '--skip-db-update'],
      ['--exit-code 0', '--exit-code 0'],
      ['--output sbom.cdx.json', '--output <file>'],
    ] as const)
      expect(() => assertUnfilteredComponentSbom(sbom.replace(needle, ''))).toThrow(
        `Trivy CycloneDX SBOM must include ${message}`,
      )
    expect(() =>
      assertUnfilteredComponentSbom(sbom.replace('--exit-code 0', '--exit-code 1')),
    ).toThrow('Trivy CycloneDX SBOM must include --exit-code 0')
    expect(() =>
      assertUnfilteredComponentSbom(sbom.replace('--format cyclonedx', '--format spdx')),
    ).toThrow('Trivy CycloneDX SBOM must include --format cyclonedx')
  })
})
