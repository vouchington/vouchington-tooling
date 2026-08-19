import { execFile, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export function gitEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')),
  ) as NodeJS.ProcessEnv
}

export interface SharedContext {
  repoRoot: string
  isInsideGitRepo: boolean
  trackedFiles: readonly string[]
  trackedFileSet: ReadonlySet<string>
  /** Lazily reads tracked files and shares the result across policy visitors. */
  readTrackedFile?: (file: string) => string | null
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  const lsOutput = await new Promise<string>((resolve, reject) => {
    const proc = spawn('git', ['-C', repoRoot, 'ls-files', '-z'], { env: gitEnv(), stdio: 'pipe' })
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    proc.stdout.on('data', (d: Buffer) => chunks.push(d))
    proc.stderr.on('data', (d: Buffer) => errChunks.push(d))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(`git ls-files failed (exit ${code}): ${Buffer.concat(errChunks).toString()}`),
        )
        return
      }
      resolve(Buffer.concat(chunks).toString())
    })
  })

  return lsOutput.split('\0').filter(Boolean)
}

// Builds the caches/helpers around an already-known tracked-file list, without spawning `git
// ls-files` again. Split out from buildSharedContext() so a caller that already has the list
// (e.g. a worker_threads worker whose parent already paid the spawn cost — worker_threads doesn't
// share module-level JS state across threads, so the cache above can't be shared directly) can
// reuse it instead of re-spawning `git ls-files` in its own process.
export function buildContextFromTrackedFiles(
  repoRoot: string,
  trackedFiles: readonly string[],
): SharedContext {
  const trackedFileSet = new Set(trackedFiles)
  const contents = new Map<string, string | null>()
  const readTrackedFile = (file: string): string | null => {
    if (!trackedFileSet.has(file)) return null
    const cached = contents.get(file)
    if (cached !== undefined) return cached
    try {
      const content = readFileSync(join(repoRoot, file), 'utf8')
      contents.set(file, content)
      return content
    } catch {
      contents.set(file, null)
      return null
    }
  }
  return {
    repoRoot,
    isInsideGitRepo: true,
    trackedFiles,
    trackedFileSet,
    readTrackedFile,
  }
}

export type NamedCheck = {
  name: string
  run: (
    ctx: SharedContext,
  ) => Promise<{ errors: string[]; fixes?: string[] }> | { errors: string[]; fixes?: string[] }
}

export async function runNamedChecks(
  repoRoot: string,
  checks: readonly NamedCheck[],
): Promise<Array<{ name: string; errors: string[]; fixes?: string[] }>> {
  const ctx = await buildSharedContext(repoRoot)
  return Promise.all(
    checks.map(async (check) => {
      const result = await check.run(ctx)
      return { name: check.name, ...result }
    }),
  )
}

export async function buildSharedContext(inputRoot: string): Promise<SharedContext> {
  // Run rev-parse checks first
  try {
    await execFileAsync('git', ['-C', inputRoot, 'rev-parse', '--is-inside-work-tree'], {
      env: gitEnv(),
    })
  } catch {
    return {
      repoRoot: inputRoot,
      isInsideGitRepo: false,
      trackedFiles: [],
      trackedFileSet: new Set(),
    }
  }

  // Get resolved root first, then use it to list files (so paths are always relative to repo root)
  const rootResult = await execFileAsync('git', ['-C', inputRoot, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    env: gitEnv(),
  })
  const repoRoot = rootResult.stdout.trim()

  const trackedFiles = await listTrackedFiles(repoRoot)
  return buildContextFromTrackedFiles(repoRoot, trackedFiles)
}
