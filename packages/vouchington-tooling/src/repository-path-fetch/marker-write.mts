import { randomUUID } from 'node:crypto'
import { link, rm, writeFile } from 'node:fs/promises'

export async function writeMarkerAtomic(path: string, contents: string): Promise<void> {
  const staged = `${path}.write-${randomUUID()}`
  await writeFile(staged, contents, { flag: 'wx', mode: 0o600 })
  try {
    await link(staged, path)
  } finally {
    await rm(staged, { force: true })
  }
}
