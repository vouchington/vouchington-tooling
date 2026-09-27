import { FeedbackDeliveryError } from './feedback-online-error.mts'
export async function feedbackDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs = 20_000,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000)
    throw new Error('feedback timeoutMs must be between 1 and 20000')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new FeedbackDeliveryError('delivery-timeout')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
