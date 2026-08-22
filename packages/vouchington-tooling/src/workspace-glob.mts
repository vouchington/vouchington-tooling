import { readdirSync } from 'node:fs'
import path from 'node:path'

export function expandWorkspaceGlob(root: string, pattern: string): string[] {
  let currents = [root]
  for (const part of pattern.split('/')) {
    const next: string[] = []
    const star = part.indexOf('*')
    for (const current of currents) {
      if (star === -1) {
        next.push(path.join(current, part))
        continue
      }
      if (part === '**') {
        next.push(current, ...descendantDirs(current))
        continue
      }
      const suffix = part.slice(star + 1)
      if (suffix.includes('*')) continue
      const prefix = part.slice(0, star)
      for (const entry of readDirs(current)) {
        if (entry.name.startsWith(prefix) && entry.name.endsWith(suffix)) {
          next.push(path.join(current, entry.name))
        }
      }
    }
    currents = next
  }
  return currents
}

function descendantDirs(dir: string): string[] {
  const found: string[] = []
  for (const entry of readDirs(dir)) {
    const child = path.join(dir, entry.name)
    found.push(child, ...descendantDirs(child))
  }
  return found
}

function readDirs(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git',
    )
  } catch {
    return []
  }
}
