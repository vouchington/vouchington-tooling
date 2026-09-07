import { describe, expect, it } from 'vitest'

import {
  completeCheckRun,
  createCheckRun,
  CheckRunError,
  type CreateCheckRunInput,
} from './github.mts'
import type { GhExec } from '../gha-post-review/github.mts'

const HEAD_SHA = 'c'.repeat(40)

function makeExec(handler: (args: readonly string[], input?: string) => string): GhExec {
  return (args, options) => handler(args, options?.input)
}

describe('createCheckRun', () => {
  it('creates an in_progress check run and returns the numeric id as a string', () => {
    let seenBody: unknown
    const exec = makeExec((args, input) => {
      expect(args.slice(0, 3)).toEqual(['api', '--method', 'POST'])
      expect(args[3]).toBe('repos/o/r/check-runs')
      seenBody = JSON.parse(input ?? '{}')
      return JSON.stringify({ id: 42 })
    })
    const id = createCheckRun(
      {
        repository: 'o/r',
        name: 'Claude Code Review',
        headSha: HEAD_SHA,
        status: 'in_progress',
        title: 'Code Review — posting findings…',
        summary: 'in progress',
      },
      exec,
    )
    expect(id).toBe('42')
    expect(seenBody).toEqual({
      name: 'Claude Code Review',
      head_sha: HEAD_SHA,
      status: 'in_progress',
      output: { title: 'Code Review — posting findings…', summary: 'in progress' },
    })
  })

  it('creates a completed check run with conclusion success', () => {
    let seenBody: unknown
    const exec = makeExec((_args, input) => {
      seenBody = JSON.parse(input ?? '{}')
      return JSON.stringify({ id: '7' })
    })
    const id = createCheckRun(
      {
        repository: 'o/r',
        name: 'Claude Code Review',
        headSha: HEAD_SHA,
        status: 'completed',
        conclusion: 'success',
        title: 'Code Review complete — no findings',
        summary: 'ok',
      },
      exec,
    )
    expect(id).toBe('7')
    expect(seenBody).toMatchObject({ status: 'completed', conclusion: 'success' })
  })

  it('creates a completed check run with conclusion neutral', () => {
    const exec = makeExec(() => JSON.stringify({ id: 1 }))
    const input: CreateCheckRunInput = {
      repository: 'o/r',
      name: 'Claude Code Review',
      headSha: HEAD_SHA,
      status: 'completed',
      conclusion: 'neutral',
      title: 'Code Review failed — the review agent did not complete successfully',
      summary: 'failed',
    }
    expect(createCheckRun(input, exec)).toBe('1')
  })

  it('rejects a head sha that is not a full lowercase 40-hex commit sha', () => {
    const exec = makeExec(() => JSON.stringify({ id: 1 }))
    expect(() =>
      createCheckRun(
        {
          repository: 'o/r',
          name: 'n',
          headSha: 'not-a-sha',
          status: 'in_progress',
          title: 't',
          summary: 's',
        },
        exec,
      ),
    ).toThrow(CheckRunError)
  })

  it('rejects a response that is not valid JSON', () => {
    const exec = makeExec(() => 'not json')
    expect(() =>
      createCheckRun(
        {
          repository: 'o/r',
          name: 'n',
          headSha: HEAD_SHA,
          status: 'in_progress',
          title: 't',
          summary: 's',
        },
        exec,
      ),
    ).toThrow('response was not valid JSON')
  })

  it('rejects a response missing an id', () => {
    const exec = makeExec(() => JSON.stringify({ ok: true }))
    expect(() =>
      createCheckRun(
        {
          repository: 'o/r',
          name: 'n',
          headSha: HEAD_SHA,
          status: 'in_progress',
          title: 't',
          summary: 's',
        },
        exec,
      ),
    ).toThrow('did not include an id')
  })

  it('rejects a non-object response body', () => {
    const exec = makeExec(() => JSON.stringify(null))
    expect(() =>
      createCheckRun(
        {
          repository: 'o/r',
          name: 'n',
          headSha: HEAD_SHA,
          status: 'in_progress',
          title: 't',
          summary: 's',
        },
        exec,
      ),
    ).toThrow('did not include an id')
  })

  it('surfaces a gh exec failure as a CheckRunError-free thrown error', () => {
    const exec: GhExec = () => {
      throw new Error('gh: command failed')
    }
    expect(() =>
      createCheckRun(
        {
          repository: 'o/r',
          name: 'n',
          headSha: HEAD_SHA,
          status: 'in_progress',
          title: 't',
          summary: 's',
        },
        exec,
      ),
    ).toThrow('gh: command failed')
  })
})

describe('completeCheckRun', () => {
  it('patches an existing check run to completed with the given conclusion', () => {
    let seenPath = ''
    let seenBody: unknown
    const exec = makeExec((args, input) => {
      seenPath = String(args[3])
      seenBody = JSON.parse(input ?? '{}')
      return ''
    })
    completeCheckRun(
      {
        repository: 'o/r',
        checkRunId: '123',
        conclusion: 'success',
        title: 'Code Review complete — 2 findings',
        summary: 'done',
      },
      exec,
    )
    expect(seenPath).toBe('repos/o/r/check-runs/123')
    expect(seenBody).toEqual({
      status: 'completed',
      conclusion: 'success',
      output: { title: 'Code Review complete — 2 findings', summary: 'done' },
    })
  })

  it('rejects a check run id that is not a positive integer', () => {
    const exec = makeExec(() => '')
    expect(() =>
      completeCheckRun(
        {
          repository: 'o/r',
          checkRunId: '12; rm -rf',
          conclusion: 'neutral',
          title: 't',
          summary: 's',
        },
        exec,
      ),
    ).toThrow(CheckRunError)
  })

  it('surfaces a gh exec failure', () => {
    const exec: GhExec = () => {
      throw new Error('gh: not found')
    }
    expect(() =>
      completeCheckRun(
        { repository: 'o/r', checkRunId: '1', conclusion: 'neutral', title: 't', summary: 's' },
        exec,
      ),
    ).toThrow('gh: not found')
  })
})
