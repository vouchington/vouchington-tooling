import { describe, expect, it, vi } from 'vitest'

import { TailQueue } from './tail-queue.mts'

describe('TailQueue', () => {
  it('retains exactly the requested byte tail across chunk boundaries', () => {
    const tail = new TailQueue(5)
    tail.append('ab')
    tail.append('cdef')

    expect(tail.toBuffer().toString()).toBe('bcdef')
    expect(tail.bytes).toBe(5)
  })

  it('drops whole old chunks before trimming a retained chunk', () => {
    const tail = new TailQueue(5)
    tail.append('a')
    tail.append('bcde')
    tail.append('f')

    expect(tail.toBuffer().toString()).toBe('bcdef')
  })

  it('replaces its queue when one chunk covers the whole tail budget', () => {
    const tail = new TailQueue(3)
    tail.append('old')
    tail.append('newer')

    expect(tail.toBuffer().toString()).toBe('wer')
    expect(tail.chunks).toHaveLength(1)
  })

  it('defers flattening retained output until a result needs it', () => {
    const tail = new TailQueue(1_000_000)
    const concat = vi.spyOn(Buffer, 'concat')
    for (let index = 0; index < 1_000; index += 1) tail.append('chunk')
    expect(concat).not.toHaveBeenCalled()

    expect(tail.toBuffer()).toHaveLength(5_000)
    expect(concat).toHaveBeenCalledOnce()
    concat.mockRestore()
  })
})
