import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runRetrospectiveTranscriptReport } from './index.mts'
it('reports incomplete root and child capture as partial while retaining available facts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'transcript-coverage-'))
  try {
    const path = join(directory, 'claude.jsonl')
    const root = JSON.stringify({ type: 'user', message: { content: 'prompt' } })
    await writeFile(path, root)
    expect((await runRetrospectiveTranscriptReport({ jsonlPath: path })).coverage).toBe('complete')
    await writeFile(path, `${root}\n{`)
    expect(await runRetrospectiveTranscriptReport({ jsonlPath: path })).toMatchObject({
      coverage: 'partial',
      markdown: expect.stringContaining('User prompts: 1'),
    })
    await writeFile(path, root)
    const children = join(directory, 'claude', 'subagents')
    await mkdir(children, { recursive: true })
    await writeFile(join(children, 'child.jsonl'), `${root}\n{`)
    expect((await runRetrospectiveTranscriptReport({ jsonlPath: path })).coverage).toBe('partial')
    await writeFile(join(children, 'child.jsonl'), 'unsupported')
    expect((await runRetrospectiveTranscriptReport({ jsonlPath: path })).coverage).toBe('partial')
    await writeFile(
      path,
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message' } }) + '\n{',
    )
    expect((await runRetrospectiveTranscriptReport({ jsonlPath: path })).coverage).toBe('partial')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
