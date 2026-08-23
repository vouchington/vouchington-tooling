import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runNugetCentralVersionCli } from './cli.mts'
import { runNugetCentralVersionCommand } from '../cli/commands/nuget-central-version.mts'

const trusted = `<Project>
  <ItemGroup>
    <PackageVersion Include="Example.One" Version="1.2.3" />
  </ItemGroup>
</Project>
`
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('nuget-central-version CLI', () => {
  it('writes the candidate file after a valid update', () => {
    const root = mkdtempSync(join(tmpdir(), 'nuget-cli-'))
    temporaryDirectories.push(root)
    const trustedPath = join(root, 'trusted.props')
    const candidatePath = join(root, 'candidate.props')
    const metadataPath = join(root, 'meta.json')
    const outputPath = join(root, 'out.props')
    const candidate = trusted.replace('Version="1.2.3"', 'Version="1.2.4"')
    writeFileSync(trustedPath, trusted)
    writeFileSync(candidatePath, candidate)
    writeFileSync(
      metadataPath,
      JSON.stringify([
        { dependencyName: 'Example.One', prevVersion: '1.2.3', newVersion: '1.2.4' },
      ]),
    )
    runNugetCentralVersionCli([trustedPath, candidatePath, metadataPath, outputPath])
    expect(readFileSync(outputPath, 'utf8')).toBe(candidate)
    expect(
      runNugetCentralVersionCommand([
        trustedPath,
        candidatePath,
        metadataPath,
        join(root, 'out2.props'),
      ]),
    ).toBe(0)
  })

  it('rejects missing arguments', () => {
    expect(() => runNugetCentralVersionCli(['a', 'b', 'c'])).toThrow('Usage:')
    expect(runNugetCentralVersionCommand(['a', 'b', 'c'])).toBe(1)
  })
})
