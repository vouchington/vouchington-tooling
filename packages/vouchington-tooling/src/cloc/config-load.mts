import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeClocConfig, type ClocConfig } from './config.mts'

export type LoadModule = (specifier: string) => Promise<unknown>

const importModule: LoadModule = (specifier) => import(specifier)

/**
 * Loads a layout config. A `.json` file is parsed; anything else is imported, and its default (or
 * named `config`) export is the config object or a function returning one.
 */
export async function loadClocConfig(
  file: string,
  cwd: string,
  load: LoadModule = importModule,
): Promise<ClocConfig> {
  const absolute = resolve(cwd, file)
  if (absolute.endsWith('.json')) {
    return normalizeClocConfig(JSON.parse(await readFile(absolute, 'utf8')))
  }
  const loaded = (await load(pathToFileURL(absolute).href)) as {
    default?: unknown
    config?: unknown
  }
  const exported = loaded.config ?? loaded.default
  return normalizeClocConfig(typeof exported === 'function' ? await exported() : exported)
}
