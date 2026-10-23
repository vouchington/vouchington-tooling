import { spawn } from 'node:child_process'
import { requireSuccess, terminateChild } from './child-process.mts'
import { normalizePath } from './patterns.mts'

/** Streams `git ls-files -z` (every entry is NUL-terminated) so the listing has no size cap. */
export async function listTrackedFiles(cwd: string): Promise<Set<string>> {
  const child = spawn('git', ['ls-files', '-z'], { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
  const completion = requireSuccess(child, 'git ls-files')
  completion.catch(() => {})
  const files = new Set<string>()
  let remainder = Buffer.alloc(0)
  let completed = false
  try {
    for await (const chunk of child.stdout) {
      const data = Buffer.concat([remainder, chunk])
      let start = 0
      for (;;) {
        const end = data.indexOf(0, start)
        if (end === -1) break
        files.add(normalizePath(data.subarray(start, end).toString('utf8')))
        start = end + 1
      }
      remainder = data.subarray(start)
    }
    await completion
    completed = true
  } finally {
    if (!completed) await terminateChild(child, completion)
  }
  return files
}
