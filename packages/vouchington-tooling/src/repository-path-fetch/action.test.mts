import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const fetchAction = readFileSync('.github/actions/fetch-repository-paths/action.yml', 'utf8')
const cleanAction = readFileSync('.github/actions/clean-workspace/action.yml', 'utf8')
const cleanWorkspace = readFileSync(
  'packages/vouchington-tooling/scripts/gha/clean-workspace.sh',
  'utf8',
)

describe('repository path fetch action', () => {
  it('invokes the CLI with the locked contract and returns immutable metadata', () => {
    expect(fetchAction).toContain(
      'uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
    )
    expect(fetchAction).toContain('node-version: 24')
    expect(fetchAction).toContain('repository-path-fetch/cli.mts')
    expect(fetchAction).toContain('--config')
    expect(fetchAction).toContain('--destination')
    expect(fetchAction).toContain('--metadata')
    expect(fetchAction).toContain('--token-env FETCH_REPOSITORY_PATHS_TOKEN')
    expect(fetchAction).toContain('FETCH_REPOSITORY_PATHS_CONFIG: ${{ inputs.config }}')
    expect(fetchAction).toContain('--config "$FETCH_REPOSITORY_PATHS_CONFIG"')
    expect(fetchAction).not.toContain('--config "${{ inputs.config }}"')
    expect(fetchAction).toContain('resolved_sha')
    expect(fetchAction).toContain('digest')
    expect(fetchAction).toContain('MAX_FETCH_METADATA_BYTES')
    expect(fetchAction).toContain('repository-path-fetch/metadata.mts')
    expect(fetchAction).toContain('const content = readFileSync(process.argv[1])')
    expect(fetchAction).toContain('content.length > MAX_FETCH_METADATA_BYTES')
    expect(fetchAction).not.toContain('statSync(process.argv[1])')
    expect(fetchAction).toContain('metadata.schemaVersion !== 1')
    expect(fetchAction).toContain('!Array.isArray(metadata.files)')
  })

  it('runs workspace cleanup without the package CLI', () => {
    expect(cleanAction).toContain('clean-workspace')
    expect(cleanAction).toContain('scripts/gha/clean-workspace.sh')
    expect(cleanAction).not.toContain('src/cli/index.mts')
    expect(cleanAction).toContain('Token used only when deepen is true')
    expect(cleanAction).toContain(
      "GITHUB_TOKEN: ${{ inputs.deepen == 'true' && inputs.token || '' }}",
    )
    expect(cleanWorkspace).toContain('-c credential.helper=')
  })

  it('loads the fetch action entrypoint without node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'repository-path-action-'))
    try {
      const entrypoint = join(root, 'repository-path-fetch', 'cli.mts')
      cpSync(
        'packages/vouchington-tooling/src/repository-path-fetch',
        join(root, 'repository-path-fetch'),
        {
          recursive: true,
        },
      )
      const config = join(root, 'config.json')
      writeFileSync(config, '{}')
      const result = spawnSync(
        'node',
        [
          '--experimental-strip-types',
          entrypoint,
          '--config',
          config,
          '--destination',
          join(root, 'bundle'),
          '--metadata',
          join(root, 'metadata'),
          '--token-env',
          'MISSING_TOKEN',
        ],
        {
          cwd: root,
          env: { ...process.env, NODE_PATH: join(root, 'node_modules') },
          encoding: 'utf8',
          stdio: 'pipe',
        },
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('token environment variable is empty: MISSING_TOKEN')
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})
