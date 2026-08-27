export async function mapBounded<T>(
  values: readonly T[],
  limit: number,
  action: (value: T) => Promise<void>,
): Promise<void> {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error('concurrency limit must be positive')
  let next = 0
  let failure: unknown
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (failure === undefined) {
        const index = next++
        if (index >= values.length) return
        try {
          await action(values[index]!)
        } catch (error) {
          failure ??= error
        }
      }
    }),
  )
  if (failure !== undefined) throw failure
}
