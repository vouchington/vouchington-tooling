import { asRecord } from './shared.mts'

export function hasMalformedInteriorRecord(lines: string[]): boolean {
  const nonblank = lines.filter((line) => line.trim())
  const complete = lines.at(-1)?.trim() ? nonblank.slice(0, -1) : nonblank
  return complete.some((line) => {
    try {
      return !asRecord(JSON.parse(line))
    } catch {
      return true
    }
  })
}
