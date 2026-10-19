import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { StoryCoverageConfig } from './options.mts'

export function workspaceFiles(config: StoryCoverageConfig): string[] {
  return [...filesUnder(config, config.componentRoot), ...filesUnder(config, config.storyRoot)]
}

function filesUnder(config: StoryCoverageConfig, directory: string): string[] {
  const relative = directory.slice(0, -1)
  if (!existsSync(join(config.root, relative))) return []
  const files: string[] = []
  const queue = [relative]
  let current = queue.shift()
  while (current !== undefined) {
    for (const entry of readdirSync(join(config.root, current), { withFileTypes: true })) {
      const child = `${current}/${entry.name}`
      if (entry.isDirectory()) queue.push(child)
      else if (isSourceFile(config, child)) files.push(child)
    }
    current = queue.shift()
  }
  return files.toSorted()
}

function isSourceFile(config: StoryCoverageConfig, file: string): boolean {
  return config.sourceExtensions.some((extension) => file.endsWith(extension))
}
