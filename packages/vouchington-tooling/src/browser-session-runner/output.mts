import { StringDecoder } from 'node:string_decoder'

import { boundPendingLine, splitCompleteLines } from '../process-line-buffer/index.mts'
import type { BrowserSessionOptions, BrowserSessionOutput } from './types.mts'
import type { TailQueue } from './tail-queue.mts'

type OutputConsumer = {
  flush(): void
  write(chunk: string | Buffer): void
}

export function createOutputConsumer(
  options: BrowserSessionOptions,
  tail: TailQueue,
  source: BrowserSessionOutput['source'],
  onLine: (line: string) => void,
): OutputConsumer {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  const appendLines = (text: string) => {
    tail.append(text)
    const split = splitCompleteLines(pending + text)
    pending = boundPendingLine(split.pending)
    for (const value of split.complete) onLine(value)
  }
  return {
    flush: () => {
      appendLines(decoder.end())
      if (pending) onLine(pending)
    },
    write: (chunk) => {
      options.onOutput?.({ chunk, source })
      appendLines(decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    },
  }
}
