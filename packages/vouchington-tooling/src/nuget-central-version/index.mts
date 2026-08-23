type DependencyUpdate = { dependencyName?: string; newVersion?: string; prevVersion?: string }

const packageVersionPattern =
  /<PackageVersion\s+Include="(?<name>[^"]+)"\s+Version="(?<version>[^"]+)"\s*\/>/g
const literalNugetVersionPattern =
  /^\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/

function parseVersions(source: string): Map<string, { literal: string; version: string }> {
  const versions = new Map<string, { literal: string; version: string }>()
  for (const match of source.matchAll(packageVersionPattern)) {
    const name = match.groups?.name
    const version = match.groups?.version
    if (!name || !version || versions.has(name)) {
      throw new Error('Directory.Packages.props must contain unique PackageVersion entries')
    }
    versions.set(name, { literal: match[0], version })
  }
  if (versions.size === 0) throw new Error('Directory.Packages.props has no PackageVersion entries')
  return versions
}

export function validateNugetUpdate(
  trustedSource: string,
  candidateSource: string,
  metadataSource: string,
): string[] {
  const trusted = parseVersions(trustedSource)
  const candidate = parseVersions(candidateSource)
  if (candidate.size !== trusted.size) {
    throw new Error('Dependabot may not add or remove central package declarations')
  }

  const changed: string[] = []
  let expected = trustedSource
  for (const [name, trustedEntry] of trusted) {
    const candidateEntry = candidate.get(name)
    if (!candidateEntry) throw new Error(`Dependabot removed central package ${name}`)
    if (candidateEntry.version === trustedEntry.version) continue
    if (!literalNugetVersionPattern.test(trustedEntry.version)) {
      throw new Error(`Dependabot may not change MSBuild-managed version for ${name}`)
    }
    if (!literalNugetVersionPattern.test(candidateEntry.version)) {
      throw new Error(`Dependabot proposed a non-literal NuGet version for ${name}`)
    }
    changed.push(name)
    expected = expected.replace(
      trustedEntry.literal,
      trustedEntry.literal.replace(
        `Version="${trustedEntry.version}"`,
        `Version="${candidateEntry.version}"`,
      ),
    )
  }
  if (changed.length === 0) throw new Error('Dependabot NuGet update changed no package versions')
  if (candidateSource !== expected) {
    throw new Error('Dependabot may change only literal central PackageVersion values')
  }

  const metadata = JSON.parse(metadataSource) as DependencyUpdate[]
  if (!Array.isArray(metadata)) throw new Error('Dependabot NuGet metadata must be an array')
  const metadataByName = new Map<string, DependencyUpdate>()
  for (const update of metadata) {
    const name = update.dependencyName?.toLowerCase()
    if (!name || !update.prevVersion || !update.newVersion || metadataByName.has(name)) {
      throw new Error('Dependabot NuGet metadata must identify every changed package exactly once')
    }
    metadataByName.set(name, update)
  }
  const metadataNames = [...metadataByName.keys()].toSorted()
  const changedNames = changed.map((name) => name.toLowerCase()).toSorted()
  if (
    metadataNames.length !== changedNames.length ||
    new Set(metadataNames).size !== metadataNames.length
  ) {
    throw new Error('Dependabot NuGet metadata must identify every changed package exactly once')
  }
  if (!metadataNames.every((name, index) => name === changedNames[index])) {
    throw new Error('Dependabot NuGet metadata does not match the changed central packages')
  }
  for (const name of changed) {
    const update = metadataByName.get(name.toLowerCase())
    const trustedVersion = trusted.get(name)?.version
    const candidateVersion = candidate.get(name)?.version
    if (update?.prevVersion !== trustedVersion || update?.newVersion !== candidateVersion) {
      throw new Error(`Dependabot NuGet metadata versions do not match ${name}`)
    }
  }
  return changed.toSorted()
}
