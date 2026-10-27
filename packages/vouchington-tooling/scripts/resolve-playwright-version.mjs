import { readFileSync } from 'node:fs'

// Browser builds follow the single playwright-core version in the lockfile.
// Callers key the browser cache on that version instead of the whole lockfile.
const lockfilePath = process.argv[2] ?? 'pnpm-lock.yaml'

let source
try {
  source = readFileSync(lockfilePath, 'utf8')
} catch {
  process.stderr.write(`::error::cannot read ${lockfilePath}\n`)
  process.exit(2)
}

if (!/^lockfileVersion:\s+['"]?9\.\d+['"]?\s*$/m.test(source)) {
  process.stderr.write('::error::pnpm-lock.yaml must use lockfileVersion 9\n')
  process.exit(2)
}

const versions = new Set()
for (const line of source.split('\n')) {
  const match = /^ {2}['"]?playwright-core@([^'"\n:]+)['"]?(?::(?: \{\})?)?$/.exec(line)
  if (!match) continue
  const version = match[1].split('(')[0]
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    process.stderr.write(`::error::playwright-core version ${version} is not numeric x.y.z\n`)
    process.exit(2)
  }
  versions.add(version)
}

if (versions.size !== 1) {
  process.stderr.write(
    `::error::expected one playwright-core version in the lockfile, found ${versions.size}\n`,
  )
  process.exit(2)
}

process.stdout.write(`${[...versions][0]}\n`)
