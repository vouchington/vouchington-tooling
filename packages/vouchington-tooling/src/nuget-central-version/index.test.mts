import { describe, expect, it } from 'vitest'

import { validateNugetUpdate } from './index.mts'

const trusted = `<Project>
  <ItemGroup>
    <PackageVersion Include="Example.One" Version="1.2.3" />
    <PackageVersion Include="Example.Two" Version="4.5.6" />
    <PackageVersion Include="Microsoft.Maui.Controls" Version="$(MauiVersion)" />
  </ItemGroup>
</Project>
`

function update(dependencyName: string, prevVersion: string, newVersion: string): object {
  return { dependencyName, prevVersion, newVersion }
}

describe('validateNugetUpdate', () => {
  it('accepts only metadata-matched literal version replacements', () => {
    const candidate = trusted
      .replace('Version="1.2.3"', 'Version="1.3.0"')
      .replace('Version="4.5.6"', 'Version="4.5.7-preview.1"')
    expect(
      validateNugetUpdate(
        trusted,
        candidate,
        JSON.stringify([
          update('Example.Two', '4.5.6', '4.5.7-preview.1'),
          update('Example.One', '1.2.3', '1.3.0'),
        ]),
      ),
    ).toEqual(['Example.One', 'Example.Two'])
  })

  it('rejects executable XML changes and property expressions', () => {
    expect(() =>
      validateNugetUpdate(
        trusted,
        trusted.replace('</Project>', '<Target Name="Injected" /></Project>'),
        '[]',
      ),
    ).toThrow('changed no package versions')
    expect(() =>
      validateNugetUpdate(
        trusted,
        trusted.replace('Version="1.2.3"', 'Version="$(Injected)"'),
        JSON.stringify([update('Example.One', '1.2.3', '$(Injected)')]),
      ),
    ).toThrow('non-literal NuGet version')
    expect(() =>
      validateNugetUpdate(
        trusted,
        trusted.replace('Version="$(MauiVersion)"', 'Version="10.0.1"'),
        JSON.stringify([update('Microsoft.Maui.Controls', '$(MauiVersion)', '10.0.1')]),
      ),
    ).toThrow('MSBuild-managed version')
  })

  it('rejects metadata or declaration-set mismatches', () => {
    const candidate = trusted.replace('Version="1.2.3"', 'Version="1.2.4"')
    expect(() => validateNugetUpdate(trusted, candidate, '[]')).toThrow(
      'identify every changed package',
    )
    expect(() =>
      validateNugetUpdate(
        trusted.replace(
          '<PackageVersion Include="Example.Two"',
          '<PackageVersion Include="Example.One"',
        ),
        trusted,
        '[]',
      ),
    ).toThrow('unique PackageVersion entries')
    expect(() =>
      validateNugetUpdate(
        trusted,
        trusted.replace('Version="1.2.3"', 'Version="1.2.4"'),
        JSON.stringify([
          update('Example.One', '1.2.3', '1.2.4'),
          update('Other', '1.0.0', '1.0.1'),
        ]),
      ),
    ).toThrow('identify every changed package')
    expect(() =>
      validateNugetUpdate(
        trusted,
        trusted.replace(
          '  </ItemGroup>',
          '    <PackageVersion Include="Injected" Version="1.0.0" />\n  </ItemGroup>',
        ),
        JSON.stringify([update('Example.One', '1.2.3', '1.2.4')]),
      ),
    ).toThrow('add or remove central package declarations')
    expect(() =>
      validateNugetUpdate(
        trusted,
        trusted
          .replace('Version="1.2.3"', 'Version="1.2.4"')
          .replace('</Project>', '<Target Name="X" /></Project>'),
        JSON.stringify([update('Example.One', '1.2.3', '1.2.4')]),
      ),
    ).toThrow('only literal central PackageVersion values')
    const renamed = trusted.replace('Include="Example.Two"', 'Include="Example.Renamed"')
    expect(() => validateNugetUpdate(trusted, renamed, '[]')).toThrow('removed central package')
    expect(() =>
      validateNugetUpdate(
        trusted,
        candidate,
        JSON.stringify([{ dependencyName: 'Example.One', newVersion: '1.2.4' }]),
      ),
    ).toThrow('identify every changed package exactly once')
    expect(() =>
      validateNugetUpdate(
        trusted,
        candidate,
        JSON.stringify([update('Example.Two', '4.5.6', '4.5.7')]),
      ),
    ).toThrow('does not match the changed central packages')
  })

  it('rejects metadata versions that do not exactly match the candidate delta', () => {
    const candidate = trusted.replace('Version="1.2.3"', 'Version="1.2.4"')
    expect(() =>
      validateNugetUpdate(
        trusted,
        candidate,
        JSON.stringify([update('Example.One', '1.2.2', '1.2.4')]),
      ),
    ).toThrow('metadata versions do not match Example.One')
    expect(() => validateNugetUpdate('<Project></Project>', '<Project></Project>', '[]')).toThrow(
      'no PackageVersion entries',
    )
    expect(() =>
      validateNugetUpdate(trusted, trusted.replace('Version="1.2.3"', 'Version="1.2.4"'), '{}'),
    ).toThrow('must be an array')
  })
})
