import { execFileSync } from 'node:child_process'

import { describe, expect, it, vi } from 'vitest'

import {
  MAX_SAMPLE_BYTES,
  parseProcessGroupRows,
  processRole,
  renderProcessGroupSample,
  samplePsProcessGroup,
  writeProcessGroupSample,
} from './process-sample.mts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const mac = [
  '  501 100 20480  0.0 S+   node /Users/me/repo/node_modules/.bin/vitest run --project ui',
  '  502 100 912384 85.3 R    /Users/me/Library/Caches/ms-playwright/chromium_headless_shell-1181/chrome-headless-shell-mac-arm64/chrome-headless-shell --headless --user-data-dir=/var/secret --remote-debugging-pipe',
  '  503 100 409600  1.2 S    /Applications/Google Chrome for Testing.app/Contents/Frameworks/Helper (Renderer).app/Contents/MacOS/Helper (Renderer) --type=renderer --secret=1',
  '  504 999 1024  0.0 S    node unrelated',
  '  505 100 2048  0.0 S    /Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing --headless',
].join('\n')

const linux = [
  '    1     1  1100  0.0 Ss   /sbin/init',
  ' 2001  2000 51200  3.5 Sl   /usr/bin/node /repo/node_modules/vitest/vitest.mjs run',
  ' 2002  2000 700000 99.9 Dl   /root/.cache/ms-playwright/chromium-1181/chrome-linux/chrome --type=gpu-process --enable-features=X',
  ' 2003  2000 300000  0.0 Z    [chrome] <defunct>',
  ' 2004  2000 100000  0.3 S    /usr/bin/chromium-browser --headless=new',
].join('\n')

describe('process group sample', () => {
  it('filters by pgid and renders mac rows without argv', () => {
    const sample = renderProcessGroupSample(mac, 100)
    expect(parseProcessGroupRows(mac, 100).map((row) => row.pid)).toEqual([501, 502, 503, 505])
    expect(sample.split('\n')[0]).toBe('  processes=4 totalRssMB=1313.0')
    expect(sample).toContain('pid=502 rssMB=891.0 cpu=85.3% stat=R role=browser')
    expect(sample).toContain('pid=503 rssMB=400.0 cpu=1.2% stat=S role=renderer')
    expect(sample).toContain('pid=501 rssMB=20.0 cpu=0.0% stat=S+ role=node')
    expect(sample).toContain('pid=505 rssMB=2.0 cpu=0.0% stat=S role=browser')
    expect(sample).not.toContain('secret')
    expect(sample).not.toContain('/Users')
    expect(sample).not.toContain('unrelated')
    expect(sample.indexOf('pid=502')).toBeLessThan(sample.indexOf('pid=503'))
  })

  it('parses linux rows including zombies and chromium-browser', () => {
    const sample = renderProcessGroupSample(linux, 2000)
    expect(sample).toContain('processes=4')
    expect(sample).toContain('pid=2002 rssMB=683.6 cpu=99.9% stat=Dl role=gpu-process')
    expect(sample).toContain('pid=2003 rssMB=293.0')
    expect(sample).toContain('stat=Z role=chrome')
    expect(sample).toContain('pid=2004 rssMB=97.7 cpu=0.3% stat=S role=browser')
    expect(sample).toContain('role=node')
    expect(sample).not.toContain('init')
  })

  it('names the role from the type token, the browser binary, or the executable', () => {
    expect(processRole('/x/chrome --type=utility --foo')).toBe('utility')
    expect(processRole('/x/headless_shell --headless')).toBe('browser')
    expect(processRole('/usr/bin/node /x.js')).toBe('node')
    expect(processRole('')).toBe('unknown')
  })

  it('reports an empty group', () => {
    expect(renderProcessGroupSample('garbage\n', 7)).toBe('  processes=0 totalRssMB=0.0\n')
  })

  it('caps the rendering and counts omitted processes', () => {
    const many = Array.from(
      { length: 300 },
      (_, i) => `${1000 + i} 42 ${1000 + i} 0.0 S node /x/${'y'.repeat(50)}`,
    ).join('\n')
    const sample = renderProcessGroupSample(many, 42)
    expect(Buffer.byteLength(sample)).toBeLessThanOrEqual(MAX_SAMPLE_BYTES)
    expect(sample).toContain('processes=300')
    expect(sample).toMatch(/\.\.\. \d+ more processes omitted\n$/)
  })

  it('runs ps -ax with a timeout and never ps -g', () => {
    const calls: unknown[][] = []
    const sample = samplePsProcessGroup(100, (...args) => (calls.push(args), mac))
    expect(calls[0]).toEqual([
      'ps',
      ['-ax', '-o', 'pid=,pgid=,rss=,pcpu=,stat=,args='],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 2000 },
    ])
    expect(sample).toContain('processes=4')
  })

  it('uses execFileSync by default', () => {
    vi.mocked(execFileSync).mockReturnValueOnce(linux)
    expect(samplePsProcessGroup(2000)).toContain('processes=4')
    expect(execFileSync).toHaveBeenCalledWith('ps', expect.any(Array), expect.any(Object))
  })

  it('writes the header and sample, skips an unknown group, and survives failures', () => {
    const out: string[] = []
    const stderr = { write: (chunk: string | Uint8Array) => (out.push(String(chunk)), true) }
    writeProcessGroupSample({ sampleProcessGroup: () => '  processes=0\n', stderr }, 77)
    expect(out).toEqual(['[storybook-browser] process group 77 at stall:\n  processes=0\n'])
    writeProcessGroupSample({ sampleProcessGroup: () => 'x', stderr }, undefined)
    expect(out).toHaveLength(1)
    const boom = () => {
      throw new Error('ps timed out')
    }
    writeProcessGroupSample({ sampleProcessGroup: boom, stderr }, 77)
    writeProcessGroupSample(
      {
        sampleProcessGroup: () => {
          throw 'plain'
        },
        stderr,
      },
      77,
    )
    expect(out.slice(1)).toEqual([
      '[storybook-browser] process group 77 sample failed: ps timed out\n',
      '[storybook-browser] process group 77 sample failed: plain\n',
    ])
  })
})
