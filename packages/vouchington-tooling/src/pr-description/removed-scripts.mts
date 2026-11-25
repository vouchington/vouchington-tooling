import type { PackageJsonReader, RemovedSurface } from './pr-description-types.mts'

function parseScripts(json: string | undefined): Record<string, unknown> {
  if (json === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const scripts = (parsed as { scripts?: unknown }).scripts
    if (typeof scripts !== 'object' || scripts === null || Array.isArray(scripts)) return {}
    return scripts as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * Exact key-set diff of pre/post `package.json` `scripts` objects. Missing or unparseable JSON on
 * either side degrades to `{}` rather than throwing.
 */
export async function findRemovedScripts(
  paths: readonly string[],
  read: PackageJsonReader,
): Promise<RemovedSurface[]> {
  const results = await Promise.all(
    paths.map(async (path) => {
      const [baseJson, headJson] = await Promise.all([read(path, 'base'), read(path, 'head')])
      const baseScripts = parseScripts(baseJson)
      const headScripts = parseScripts(headJson)
      const surfaces: RemovedSurface[] = []
      for (const name of Object.keys(baseScripts)) {
        if (!(name in headScripts)) surfaces.push({ name, path, type: 'removed-script' })
      }
      return surfaces
    }),
  )
  return results.flat()
}
