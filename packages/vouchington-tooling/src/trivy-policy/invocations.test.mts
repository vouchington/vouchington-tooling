import { describe, expect, it } from 'vitest'

import {
  assertVulnerabilityGate,
  isTrivyPackageScanCommand,
  trivyPackageScanCommandSegments,
} from './index.mts'

const completeGate =
  'trivy image --scanners vuln --quiet --skip-db-update --pkg-types os --exit-code "$TRIVY_FINDINGS_EXIT_CODE" --severity CRITICAL,HIGH --ignore-unfixed --ignorefile .trivyignore.yaml --format table --table-mode detailed --output report.txt target'
const noScanners = 'Trivy vulnerability scan must include --scanners vuln'

describe('Trivy invocation discovery', () => {
  it('recognizes global flags, quoted subcommands and Kubernetes aliases', () => {
    for (const command of [
      'trivy --quiet image target',
      'trivy "image" target',
      'trivy \\\n  --quiet \\\n  image target',
      'trivy k8s cluster',
      'trivy kubernetes cluster',
    ])
      expect(isTrivyPackageScanCommand(command)).toBe(true)
    expect(isTrivyPackageScanCommand('echo trivy image')).toBe(false)
    expect(isTrivyPackageScanCommand('trivy --version')).toBe(false)
  })

  it('rejects wrappers and groups around a package scan but not other wrapped commands', () => {
    for (const command of [
      'if trivy image target',
      'command trivy image target',
      'timeout 5m trivy image target',
    ])
      expect(() => isTrivyPackageScanCommand(command)).toThrow(
        'unsupported wrapper before Trivy package scan',
      )
    expect(() => isTrivyPackageScanCommand('(trivy image target)')).toThrow(
      'unsupported grouped Trivy package scan',
    )
    expect(isTrivyPackageScanCommand('timeout 5m trivy --version')).toBe(false)
    expect(isTrivyPackageScanCommand('env A=1 trivy image target')).toBe(true)
  })

  it('rejects inline TRIVY_* options that could filter a scan but allows cache settings', () => {
    expect(() =>
      trivyPackageScanCommandSegments('TRIVY_SKIP_FILES=/lib/apk/db/installed trivy image target'),
    ).toThrow('unsupported Trivy environment option TRIVY_SKIP_FILES')
    expect(trivyPackageScanCommandSegments('TRIVY_CACHE_DIR=/c trivy image target')).toHaveLength(1)
    expect(trivyPackageScanCommandSegments('TRIVY_SKIP_FILES=x trivy --version')).toEqual([])
  })

  it('normalizes path-qualified, escaped and continued executable names', () => {
    expect(trivyPackageScanCommandSegments('./trivy image target')).toEqual([
      './trivy image target',
    ])
    for (const executable of ['\\trivy', 'triv\\y', '/opt/homebrew/bin/triv\\y']) {
      const [segment] = trivyPackageScanCommandSegments(`${executable} image target`)
      expect(() => assertVulnerabilityGate(segment!)).toThrow(noScanners)
    }
    const [continued] = trivyPackageScanCommandSegments('tri\\\nvy image target')
    expect(continued).toBe('trivy image target')
  })

  it('splits pipelines and newlines, and skips comments', () => {
    expect(trivyPackageScanCommandSegments('echo x | trivy image target')).toEqual([
      ' trivy image target',
    ])
    expect(trivyPackageScanCommandSegments('echo x # | trivy image target')).toEqual([])
    const commands = trivyPackageScanCommandSegments(`# setup\n${completeGate}`)
    expect(commands).toEqual([completeGate])
    expect(() => assertVulnerabilityGate(commands[0]!)).not.toThrow()
    expect(trivyPackageScanCommandSegments('echo trivy image target')).toEqual([])
    expect(
      trivyPackageScanCommandSegments('trivy image a && trivy fs b; trivy repo c || true'),
    ).toHaveLength(3)
  })

  it('rejects background scans, substitutions and indirect execution', () => {
    for (const command of ['trivy image target & echo', `${completeGate} &`, '& trivy image t'])
      expect(() => trivyPackageScanCommandSegments(command)).toThrow(
        'unsupported background Trivy package scan',
      )
    expect(trivyPackageScanCommandSegments('trivy image a 2>&1 &&  echo')).toHaveLength(1)
    for (const command of ['r=$(trivy image target)', 'r=`trivy image target`'])
      expect(() => trivyPackageScanCommandSegments(command)).toThrow(
        'unsupported Trivy command substitution',
      )
    expect(() => trivyPackageScanCommandSegments('<(/opt/bin/trivy image target)')).toThrow(
      'unsupported Trivy process substitution',
    )
    for (const command of [
      "bash -c 'trivy image target'",
      "bash -lc 'trivy image target'",
      'echo "$(command trivy image target)"',
      "eval 'trivy image target'",
      "eval 'command trivy image target'",
    ])
      expect(() => trivyPackageScanCommandSegments(command)).toThrow(
        /unsupported (Trivy command substitution|indirect Trivy execution)/,
      )
  })
})
