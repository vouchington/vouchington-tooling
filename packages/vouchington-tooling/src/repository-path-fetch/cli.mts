import { readRepositoryPathFetchConfig } from './config.mts'
import { fetchRepositoryPaths } from './fetch.mts'
import { isMainModule } from './main-module.mts'
import { outputExists, recoverIncompletePublish } from './publish.mts'
import { parseRepositoryPathFetchConfig, validateDestination } from './validation.mts'

export async function runRepositoryPathFetch(args: readonly string[]): Promise<number> {
  try {
    const options = parseArgs(args)
    validateDestination(options.destination)
    validateDestination(options.metadata)
    await recoverIncompletePublish(options.destination, options.metadata)
    if (outputExists(options.destination) || outputExists(options.metadata))
      throw new Error('output already exists')
    const token = process.env[options.tokenEnv]
    if (!token) throw new Error(`token environment variable is empty: ${options.tokenEnv}`)
    const config = parseRepositoryPathFetchConfig(
      JSON.parse(await readRepositoryPathFetchConfig(options.config)),
    )
    const metadata = await fetchRepositoryPaths({
      apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com/',
      config,
      destination: options.destination,
      metadata: options.metadata,
      token,
    })
    process.stdout.write(`${JSON.stringify(metadata)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(
      `fetch-repository-paths: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

function parseArgs(args: readonly string[]): {
  config: string
  destination: string
  metadata: string
  tokenEnv: string
} {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if (
      !['--config', '--destination', '--metadata', '--token-env'].includes(flag ?? '') ||
      value === undefined ||
      values.has(flag!)
    )
      throw new Error('expected --config --destination --metadata --token-env')
    values.set(flag!, value)
  }
  const tokenEnv = values.get('--token-env')
  if (!tokenEnv || !/^[A-Z][A-Z0-9_]*$/.test(tokenEnv))
    throw new Error('token environment variable name is invalid')
  const config = values.get('--config')
  const destination = values.get('--destination')
  const metadata = values.get('--metadata')
  if (!config || !destination || !metadata)
    throw new Error('expected --config --destination --metadata --token-env')
  return { config, destination, metadata, tokenEnv }
}

/* v8 ignore next 2 -- exercised as the executable composite-action entrypoint */
if (isMainModule(import.meta.url, process.argv[1]))
  process.exitCode = await runRepositoryPathFetch(process.argv.slice(2))
