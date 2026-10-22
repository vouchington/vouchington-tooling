import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../agent-blackboard/index.mts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent-blackboard/index.mts')>()
  return { ...actual, probeBlackboard: vi.fn() }
})
vi.mock('../../agent-blackboard/snapshot.mts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../agent-blackboard/snapshot.mts')>()
  return { ...actual, cleanupSnapshotPartitions: vi.fn(), partitionSnapshot: vi.fn() }
})
vi.mock('../../retrospective-distill/index.mts', () => ({ runDistillClassify: vi.fn() }))

import { runAgentBlackboardCommand } from './agent-blackboard.mts'
import { probeBlackboard } from '../../agent-blackboard/index.mts'
import { cleanupSnapshotPartitions, partitionSnapshot } from '../../agent-blackboard/snapshot.mts'
import { runDistillClassify } from '../../retrospective-distill/index.mts'

describe('agent-blackboard CLI', () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  afterEach(() => {
    stderr.mockClear()
    stdout.mockClear()
    vi.mocked(probeBlackboard).mockReset()
    vi.mocked(cleanupSnapshotPartitions).mockReset()
    vi.mocked(partitionSnapshot).mockReset()
    vi.mocked(runDistillClassify).mockReset()
  })

  it('no longer exposes the journal subcommands', async () => {
    for (const action of ['append', 'entries', 'status', 'flush']) {
      await expect(runAgentBlackboardCommand(['journal', action])).resolves.toBe(2)
      expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('usage: agent-blackboard probe')
    }
  })

  it('names every remaining command in its root usage failure', async () => {
    await expect(runAgentBlackboardCommand([])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('distill classify')
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('snapshot partition|cleanup')
    await expect(runAgentBlackboardCommand(['distill', 'other'])).resolves.toBe(2)
  })

  it('runs the probe command through its service boundary', async () => {
    await expect(runAgentBlackboardCommand(['probe'])).resolves.toBe(0)
    expect(probeBlackboard).toHaveBeenCalledOnce()
    await expect(runAgentBlackboardCommand(['probe', 'extra'])).resolves.toBe(2)
  })

  it('prints distill classify output and reports its argument errors', async () => {
    vi.mocked(runDistillClassify).mockResolvedValueOnce('s1\tshape\teligible')
    await expect(
      runAgentBlackboardCommand(['distill', 'classify', 'p.jsonl', '--retro-cutoff', 'x']),
    ).resolves.toBe(0)
    expect(runDistillClassify).toHaveBeenCalledWith(['p.jsonl', '--retro-cutoff', 'x'])
    expect(stdout).toHaveBeenLastCalledWith('s1\tshape\teligible\n')
    vi.mocked(runDistillClassify).mockRejectedValueOnce(new Error('--retro-cutoff is required'))
    await expect(runAgentBlackboardCommand(['distill', 'classify', 'p.jsonl'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('--retro-cutoff is required')
    vi.mocked(runDistillClassify).mockRejectedValueOnce('boom')
    await expect(runAgentBlackboardCommand(['distill', 'classify'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('boom')
  })

  it('rejects unknown and duplicate flags', async () => {
    await expect(
      runAgentBlackboardCommand(['snapshot', 'cleanup', '--unexpected', 'value']),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('unknown option')
    await expect(
      runAgentBlackboardCommand(['snapshot', 'cleanup', '--snapshot', 'a', '--snapshot', 'b']),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('duplicate option')
  })

  it('requires a cleanup receipt for partition directories', async () => {
    await expect(
      runAgentBlackboardCommand([
        'snapshot',
        'cleanup',
        '--partition-directory',
        '/tmp/partitions',
      ]),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('--receipt is required')
  })

  it('reports incomplete options and unknown snapshot actions', async () => {
    await expect(runAgentBlackboardCommand(['snapshot', 'other'])).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('snapshot partition|cleanup')
    await expect(
      runAgentBlackboardCommand(['snapshot', 'cleanup', undefined as never]),
    ).resolves.toBe(2)
    expect(String(stderr.mock.calls.at(-1)?.[0])).toContain('invalid option: ')
  })

  it('runs snapshot partition and cleanup commands through their service boundaries', async () => {
    const receipt = { nonce: 'receipt' }
    vi.mocked(partitionSnapshot).mockResolvedValue({ partitions: [] } as never)
    await expect(
      runAgentBlackboardCommand([
        'snapshot',
        'partition',
        '--snapshot',
        'snapshot.json',
        '--checksum',
        'checksum',
        '--counts',
        '{"entries":1}',
      ]),
    ).resolves.toBe(0)
    expect(partitionSnapshot).toHaveBeenCalledWith({
      path: 'snapshot.json',
      checksum: { algorithm: 'sha256', value: 'checksum' },
      counts: { entries: 1 },
    })
    await expect(
      runAgentBlackboardCommand([
        'snapshot',
        'cleanup',
        '--snapshot',
        'snapshot.json',
        '--partition-directory',
        'partitions',
        '--receipt',
        JSON.stringify(receipt),
      ]),
    ).resolves.toBe(0)
    expect(cleanupSnapshotPartitions).toHaveBeenCalledWith({
      path: 'snapshot.json',
      directory: 'partitions',
      receipt,
    })
    await expect(
      runAgentBlackboardCommand(['snapshot', 'cleanup', '--snapshot', 'snapshot.json']),
    ).resolves.toBe(0)
    expect(cleanupSnapshotPartitions).toHaveBeenLastCalledWith({ path: 'snapshot.json' })
    await expect(
      runAgentBlackboardCommand([
        'snapshot',
        'cleanup',
        '--partition-directory',
        'partitions',
        '--receipt',
        JSON.stringify(receipt),
      ]),
    ).resolves.toBe(0)
    expect(cleanupSnapshotPartitions).toHaveBeenLastCalledWith({
      directory: 'partitions',
      receipt,
    })
    expect(String(stdout.mock.calls.at(-1)?.[0])).toBe('{"cleaned":true}\n')
  })
})
