import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type Fixture = { repo: string; binary: string; baseline: string }

export const orphan = { category: 'unused-file', path: 'orphan.mts', name: '' }

/** Writes a stand-in analyzer that records its config and emits `findings`. */
export async function analyzer(directory: string, findings: unknown[]): Promise<string> {
  const binary = join(directory, 'analyzer.mjs')
  const report = { statistics: { files: 3, unparsed: 0 }, findings }
  await writeFile(
    binary,
    `#!/usr/bin/env node
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
const out = process.argv[process.argv.indexOf('--output') + 1]
mkdirSync(out, { recursive: true })
copyFileSync(process.argv[process.argv.indexOf('--config') + 1], out + '/seen-config.json')
writeFileSync(out + '/basta-report.json', ${JSON.stringify(JSON.stringify(report))})
`,
  )
  await chmod(binary, 0o755)
  return binary
}

/** A git repository with a tracked config, an entry file, and a tracked orphan. */
export async function fixture(findings: unknown[] = [orphan]): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'dead-code-gate-test-'))
  const repo = join(directory, 'repo')
  await mkdir(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  await writeFile(join(repo, 'main.mts'), 'export const live = 1\n')
  await writeFile(join(repo, 'orphan.mts'), 'export const orphan = 2\n')
  await writeFile(join(repo, '.jscpd.json'), JSON.stringify({ deadCode: { entry: ['main.mts'] } }))
  execFileSync('git', ['add', '.'], { cwd: repo })
  return {
    repo,
    binary: await analyzer(directory, findings),
    baseline: join(repo, 'baseline.json'),
  }
}
