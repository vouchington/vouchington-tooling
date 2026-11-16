import { readdir, stat } from 'node:fs/promises'

type Completion = { code: number | null; stderr: string }

async function describePath(path: string): Promise<string> {
  try {
    await stat(path)
  } catch {
    return 'absent'
  }
  const entries = await readdir(path).catch(() => undefined)
  return entries === undefined ? 'present' : `present [${entries.join(', ')}]`
}

// On failure, rethrows with the lock dir, guard, and both wrappers' exit codes
// and stderr so a recurrence of an overlapping-holders flake names the cause.
export async function assertWithLockDiagnostics(
  { lockRoot, lockName, guard }: { lockRoot: string; lockName: string; guard: string },
  results: Completion[],
  assertion: () => void,
): Promise<void> {
  try {
    assertion()
  } catch (error) {
    const diagnostics = [
      `lock dir ${lockRoot}/${lockName}.lock.d: ${await describePath(`${lockRoot}/${lockName}.lock.d`)}`,
      `reap dir: ${await describePath(`${lockRoot}/${lockName}.lock.reap.d`)}`,
      `guard ${guard}: ${await describePath(guard)}`,
      ...results.map(
        (result, index) =>
          `wrapper ${index + 1}: code=${result.code} stderr=${JSON.stringify(result.stderr)}`,
      ),
    ]
    throw new Error(`${String(error)}\n${diagnostics.join('\n')}`, { cause: error })
  }
}
