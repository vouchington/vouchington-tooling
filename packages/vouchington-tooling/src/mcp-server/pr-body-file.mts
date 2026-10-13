import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Writes the body to a private temp file for the duration of `use`, then removes it. */
export async function withBodyFile<T>(body: string, use: (file: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'vouchington-pr-'))
  try {
    const file = join(directory, 'body.md')
    await writeFile(file, body, { mode: 0o600 })
    return await use(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** The pull request number at the end of the URL `gh pr create` prints. */
export function pullRequestNumber(url: string): number {
  const match = /\/pull\/(\d+)\s*$/.exec(url)
  if (!match) throw new Error(`could not read the pull request number from: ${url}`)
  return Number(match[1])
}
