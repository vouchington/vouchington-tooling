export interface ReadResponseBodyOptions {
  readonly response: Response
  readonly url: string
  readonly maxSizeBytes: number
  readonly signal?: AbortSignal
}

export class MissingResponseBodyError extends Error {
  readonly url: string

  constructor(url: string) {
    super(`HTTP response from ${url} has no body`)
    this.name = 'MissingResponseBodyError'
    this.url = url
  }
}

export class ResponseBodyTooLargeError extends Error {
  readonly url: string
  readonly sizeBytes: number
  readonly maxSizeBytes: number

  constructor(url: string, sizeBytes: number, maxSizeBytes: number) {
    super(`HTTP response from ${url} exceeded ${maxSizeBytes} bytes (read ${sizeBytes})`)
    this.name = 'ResponseBodyTooLargeError'
    this.url = url
    this.sizeBytes = sizeBytes
    this.maxSizeBytes = maxSizeBytes
  }
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  if (signal.reason !== undefined) return new Error(String(signal.reason))
  return new Error('HTTP response body read aborted')
}

function validateMaxSize(maxSizeBytes: number): void {
  if (!Number.isSafeInteger(maxSizeBytes) || maxSizeBytes < 0) {
    throw new RangeError('maxSizeBytes must be a non-negative safe integer')
  }
}

export async function readResponseBodyAsBuffer({
  response,
  url,
  maxSizeBytes,
  signal,
}: ReadResponseBodyOptions): Promise<Buffer> {
  validateMaxSize(maxSizeBytes)
  const reader = response.body?.getReader()
  if (!reader) throw new MissingResponseBodyError(url)

  let abortListener: (() => void) | undefined
  let abortPromise: Promise<never> | undefined
  if (signal) {
    abortPromise = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        const reason = abortReason(signal)
        void reader.cancel(reason).catch(() => undefined)
        reject(reason)
      }
      if (signal.aborted) abortListener()
      else signal.addEventListener('abort', abortListener, { once: true })
    })
    void abortPromise.catch(() => undefined)
  }

  const chunks: Uint8Array[] = []
  let totalSize = 0
  try {
    for (;;) {
      const result = await (abortPromise
        ? Promise.race([reader.read(), abortPromise])
        : reader.read())
      if (signal?.aborted) throw abortReason(signal)
      if (result.done) return Buffer.concat(chunks, totalSize)
      totalSize += result.value.byteLength
      if (totalSize > maxSizeBytes) {
        const error = new ResponseBodyTooLargeError(url, totalSize, maxSizeBytes)
        await reader.cancel(error).catch(() => undefined)
        throw error
      }
      chunks.push(result.value)
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    if (signal && abortListener) signal.removeEventListener('abort', abortListener)
    reader.releaseLock()
  }
}

export async function readResponseBody(options: ReadResponseBodyOptions): Promise<string> {
  return (await readResponseBodyAsBuffer(options)).toString('utf8')
}
