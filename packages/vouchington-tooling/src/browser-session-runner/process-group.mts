export function isProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export async function waitForProcessGroupExit(processGroupId: number): Promise<void> {
  while (isProcessGroupAlive(processGroupId))
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
}
