export class ProcessGroupDrainTimeoutError extends Error {
  constructor(processGroupId: number, timeoutMs: number) {
    super(`Process group ${processGroupId} did not exit within ${timeoutMs}ms after SIGKILL`)
    this.name = 'ProcessGroupDrainTimeoutError'
  }
}

export function isProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export async function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (isProcessGroupAlive(processGroupId)) {
    if (performance.now() >= deadline)
      throw new ProcessGroupDrainTimeoutError(processGroupId, timeoutMs)
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.min(10, deadline - performance.now())),
    )
  }
}
