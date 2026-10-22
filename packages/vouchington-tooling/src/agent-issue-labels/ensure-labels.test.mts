import { describe, expect, it, vi } from 'vitest'
import { ensureLabels } from './ensure-labels.mts'
import { parseLabelPolicy } from './label-policy.mts'

const policy = parseLabelPolicy({
  labels: { 'tier: one': { color: 'b60205', description: 'Top tier.' } },
  strictPrefixes: ['tier:'],
})

function fakeRun(existing: string[] = [], failures: Array<(args: string[]) => boolean> = []) {
  return vi.fn(async (args: string[]) => {
    if (failures.some((fails) => fails(args))) throw new Error(`gh failed: ${args[0]}`)
    return args[0] === 'api' && args.includes('--paginate')
      ? JSON.stringify([existing.map((name) => ({ name }))])
      : ''
  })
}

const listCall = (base: string) => [
  'api',
  '--paginate',
  '--slurp',
  '-X',
  'GET',
  base,
  '-F',
  'per_page=100',
]

describe('ensureLabels', () => {
  it('creates only missing labels and leaves existing ones untouched', async () => {
    const run = fakeRun(['kept'])
    const result = await ensureLabels({ labels: ['tier: one', 'kept', 'new'], policy, run })
    expect(result).toEqual(['tier: one', 'kept', 'new'])
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      listCall('repos/{owner}/{repo}/labels'),
      ['label', 'create', 'tier: one', '--color', 'b60205', '--description', 'Top tier.'],
      [
        'label',
        'create',
        'new',
        '--color',
        'EDEDED',
        '--description',
        'Repository issue classification: new.',
      ],
    ])
  })

  it('targets an explicit repository and forces updates when asked', async () => {
    const run = fakeRun(['kept'])
    await ensureLabels({ labels: ['kept'], repo: 'owner/repo', update: true, run })
    expect(run.mock.calls.map(([args]) => args)).toEqual([
      listCall('repos/owner/repo/labels'),
      [
        'label',
        'create',
        'kept',
        '--color',
        'EDEDED',
        '--description',
        'Repository issue classification: kept.',
        '--force',
        '--repo',
        'owner/repo',
      ],
    ])
  })

  it('accepts a label created concurrently', async () => {
    const run = fakeRun([], [(args) => args[0] === 'label'])
    await expect(ensureLabels({ labels: ['a b'], run })).resolves.toEqual(['a b'])
    expect(run.mock.calls.at(-1)?.[0]).toEqual([
      'api',
      'repos/{owner}/{repo}/labels/a%20b',
      '--silent',
    ])
  })

  it('rethrows the create error when the label still does not exist', async () => {
    const run = fakeRun([], [(args) => args[0] === 'label', (args) => args.includes('--silent')])
    await expect(ensureLabels({ labels: ['x'], run })).rejects.toThrow('gh failed: label')
  })

  it('does not hide create errors during an update', async () => {
    const run = fakeRun([], [(args) => args[0] === 'label'])
    await expect(ensureLabels({ labels: ['x'], update: true, run })).rejects.toThrow(
      'gh failed: label',
    )
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('validates labels before calling gh', async () => {
    const run = fakeRun()
    await expect(ensureLabels({ labels: [], run })).rejects.toThrow('at least one label')
    await expect(ensureLabels({ labels: ['tier: two'], policy, run })).rejects.toThrow(
      'unsupported tier: label',
    )
    expect(run).not.toHaveBeenCalled()
  })
})
