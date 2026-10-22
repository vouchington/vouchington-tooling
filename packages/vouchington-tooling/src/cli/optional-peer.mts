/**
 * Loads a command module that value-imports an optional peer dependency. A missing peer becomes
 * an actionable error; any other load failure is rethrown unchanged.
 */
export async function loadWithOptionalPeer<T>(
  command: string,
  peer: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (
      (error as { code?: unknown }).code === 'ERR_MODULE_NOT_FOUND' &&
      error instanceof Error &&
      error.message.includes(`'${peer}'`)
    ) {
      throw new Error(
        `${command} requires the optional peer dependency ${peer}; install it alongside vouchington-tooling`,
        { cause: error },
      )
    }
    throw error
  }
}
