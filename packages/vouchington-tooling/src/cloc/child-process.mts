import type { ChildProcess } from 'node:child_process'

export async function requireSuccess(child: ChildProcess, label: string): Promise<void> {
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (code !== 0) throw new Error(`${label} exited with status ${String(code)}`)
}

export async function terminateChild(
  child: ChildProcess,
  completion: Promise<void>,
): Promise<void> {
  child.stdout?.destroy()
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await completion.catch(() => {})
}
