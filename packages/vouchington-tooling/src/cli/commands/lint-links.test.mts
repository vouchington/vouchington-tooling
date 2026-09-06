import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const script = join(process.cwd(), 'packages/vouchington-tooling/scripts/gha/lint-links.sh')
const testDirs: string[] = []

function cleanGitEnv() {
  const env = { ...process.env }
  delete env.GIT_DIR
  delete env.GIT_INDEX_FILE
  delete env.GIT_PREFIX
  delete env.GIT_WORK_TREE
  return env
}

afterEach(async () => {
  await Promise.all(testDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'lint-links-'))
  testDirs.push(dir)
  await writeFile(join(dir, 'README.md'), '# README\n\nhttps://example.com\n')
  await writeFile(join(dir, 'lychee.toml'), 'exclude_path = []\n')
  await writeFile(join(dir, 'custom.toml'), 'exclude_path = []\n')
  return dir
}

async function makeFakeLycheeBin() {
  const dir = await mkdtemp(join(tmpdir(), 'lychee-bin-'))
  testDirs.push(dir)
  await writeFile(
    join(dir, 'lychee'),
    `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "$LYCHEE_CAPTURE"
printf '===\\n' >> "$LYCHEE_CAPTURE"
is_offline=false
for arg in "$@"; do
  [ "$arg" = "--offline" ] && is_offline=true
done
case "\${LYCHEE_FAIL_PASS:-}" in
  all) exit 1 ;;
  offline) if [ "$is_offline" = "true" ]; then exit 1; fi ;;
  external) if [ "$is_offline" = "false" ]; then exit 1; fi ;;
esac
exit 0
`,
  )
  await chmod(join(dir, 'lychee'), 0o755)
  await writeFile(
    join(dir, 'git'),
    '#!/usr/bin/env bash\nset -euo pipefail\nif [ "${1:-}" = "-C" ]; then shift 2; fi\nif [ "${1:-}" = "ls-files" ]; then\n  printf \'README.md\\0\'\n  exit 0\nfi\nprintf \'unexpected fake git invocation: %s\\n\' "$*" >&2\nexit 2\n',
  )
  await chmod(join(dir, 'git'), 0o755)
  return dir
}

async function runLintLinks(
  args: string[],
  cwd: string,
  failPass?: 'offline' | 'external' | 'all',
) {
  const fakeBin = await makeFakeLycheeBin()
  const capturePath = join(fakeBin, 'lychee-args.txt')
  let stdout = ''
  let exitCode = 0
  try {
    const result = await execFileAsync('/bin/bash', [script, ...args], {
      cwd,
      env: {
        ...cleanGitEnv(),
        LYCHEE_CAPTURE: capturePath,
        LYCHEE_FAIL_PASS: failPass ?? '',
        PATH: [fakeBin, process.env.PATH].filter(Boolean).join(':'),
      },
    })
    stdout = result.stdout
  } catch (error: unknown) {
    // oxlint-disable-next-line no-mistakes/ts-no-const-aliases -- retain captured process output when adapting the fixture failure
    const execError = error as { stdout?: string; code?: number }
    stdout = execError.stdout ?? ''
    exitCode = execError.code ?? 1
  }
  return { captured: await readFile(capturePath, 'utf8').catch(() => ''), stdout, exitCode }
}

describe('lint-links', () => {
  it('runs internal then external passes', { timeout: 15_000 }, async () => {
    const dir = await makeRepo()
    const { captured, exitCode } = await runLintLinks([], dir)
    expect(exitCode).toBe(0)
    const [pass1, pass2] = captured.split('===\n')
    expect(pass1).toContain('--config\nlychee.toml\n')
    expect(pass1).toContain('--offline\n')
    expect(pass1).toContain('--include-fragments\n')
    expect(pass2).toContain('--scheme\nhttp\n')
    expect(pass2).toContain('--scheme\nhttps\n')
  })

  it('hard-fails when the internal pass fails', { timeout: 15_000 }, async () => {
    const dir = await makeRepo()
    expect((await runLintLinks([], dir, 'offline')).exitCode).not.toBe(0)
  })

  it('warns without failing when the external pass fails', { timeout: 15_000 }, async () => {
    const dir = await makeRepo()
    const { exitCode, stdout } = await runLintLinks([], dir, 'external')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('::warning')
  })

  it('skips the external pass for --offline', { timeout: 15_000 }, async () => {
    const dir = await makeRepo()
    const { captured, exitCode } = await runLintLinks(['--offline'], dir)
    expect(exitCode).toBe(0)
    expect(captured.split('===\n')).toHaveLength(2)
  })

  it('forwards --config and extra options', { timeout: 15_000 }, async () => {
    const dir = await makeRepo()
    const { captured } = await runLintLinks(['--config', 'custom.toml', '--verbose'], dir)
    const [pass1, pass2] = captured.split('===\n')
    expect(pass1).toContain('--config\ncustom.toml\n')
    expect(pass1).toContain('--verbose\n')
    expect(pass2).toContain('--verbose\n')
  })
})
