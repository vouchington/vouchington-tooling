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
      const suffix = part.slice(star + 1)
      if (suffix.includes('*')) continue
      const prefix = part.slice(0, star)
      let entries
      try {
        entries = readdirSync(current, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix)) {
          next.push(path.join(current, entry.name))
        }
      }
    }
    currents = next
  }
  return currents
}
