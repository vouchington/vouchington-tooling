import { parseArgs } from 'node:util'
import { loadClocConfig, type LoadModule } from '../../cloc/config-load.mts'
import { countFiles } from '../../cloc/count.mts'
import { buildRows, formatRows } from '../../cloc/rows.mts'
import { commandUsage } from '../usage.mts'

/**
 * `vouchington cloc --config <file> [--scc-bin <path>] [--json]`: counts tracked lines of code with
 * scc, classified by the layout config into categories and services, and prints a table. Exits 0
 * on success, 2 on a usage error, 1 when the config cannot load or counting fails.
 */
export async function runClocCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  load?: LoadModule,
): Promise<number> {
  let values: { config?: string; 'scc-bin'?: string; json?: boolean }
  try {
    const parsed = parseArgs({
      args: [...args],
      allowPositionals: false,
      options: {
        config: { type: 'string' },
        'scc-bin': { type: 'string' },
        json: { type: 'boolean' },
      },
    })
    values = parsed.values
    if (values.config === undefined) throw new Error('--config <file> is required')
  } catch (error) {
    process.stderr.write(`vouchington: ${(error as Error).message}\n${commandUsage('cloc')}`)
    return 2
  }
  try {
    const cwd = process.cwd()
    const config = await loadClocConfig(values.config, cwd, load)
    const files = await countFiles(config, {
      cwd,
      env,
      ...(values['scc-bin'] === undefined ? {} : { sccBin: values['scc-bin'] }),
    })
    const rows = buildRows(files, config)
    process.stdout.write(
      values.json ? `${JSON.stringify(rows, null, 2)}\n` : `${formatRows(rows, config)}\n`,
    )
    return 0
  } catch (error) {
    process.stderr.write(`vouchington: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
