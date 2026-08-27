import { randomUUID } from 'node:crypto'
import { link, rm, writeFile } from 'node:fs/promises'
import { outputIdentity, type OutputIdentity } from './output-identity.mts'

export async function writeMarkerAtomic(
  path: string,
  contents: string,
  write: (path: string, contents: string) => Promise<void> = async (target, value) => {
    await writeFile(target, value, { flag: 'wx', mode: 0o600 })
  },
  createLink: (from: string, to: string) => Promise<void> = link,
  removeStaged: (path: string) => Promise<void> = async (target) => {
    await rm(target, { force: true })
  },
  removePublished: (path: string) => Promise<void> = async (target) => {
    await rm(target, { force: true })
  },
  identify: (path: string) => Promise<OutputIdentity> = outputIdentity,
): Promise<OutputIdentity> {
  const staged = `${path}.write-${randomUUID()}`
  await write(staged, contents)
  try {
    await createLink(staged, path)
  } catch (error) {
    await removeStaged(staged)
    throw error
  }
  const identity = await identify(staged)
  try {
    await removeStaged(staged)
  } catch (error) {
    await removePublished(path)
    throw error
  }
  return identity
}
