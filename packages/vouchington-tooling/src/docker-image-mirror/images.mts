import { withoutShellComment } from '../trivy-policy/shell.mts'

// Unauthenticated Docker Hub pulls from hosted runners hit its rate limit. A pull-through mirror
// serves the same pinned digest without credentials, so every image must name a non-Hub registry.
// Shell scripts are not workflow bodies and are outside this scan.
export const DEFAULT_MIRROR = 'mirror.gcr.io'
const HUB_HOSTS = ['docker.io', 'index.docker.io', 'registry-1.docker.io']
const VALUE_FLAGS = new Set(
  '-e --env -p --publish -v --volume --name --network --net --add-host --entrypoint -u --user -w --workdir --tmpfs --platform --mount --label -l --env-file --health-cmd --health-interval --health-retries --health-timeout --health-start-period -m --memory --cpus --restart --cap-add --cap-drop --shm-size --log-driver --ulimit -h --hostname --pull --pids-limit --group-add --device --dns --ipc --pid --cgroupns --stop-signal --stop-timeout'.split(
    ' ',
  ),
)

type Step = { name?: string; run?: string; uses?: string; with?: Record<string, unknown> }
export type Document = {
  jobs?: Record<
    string,
    {
      container?: string | { image?: string }
      services?: Record<string, { image?: string }>
      steps?: Step[]
    }
  >
  runs?: { steps?: Step[]; image?: string }
}

function isHubImage(reference: string): boolean {
  const image = reference.replace(/^["']|["'),;]+$/gu, '')
  if (image === '' || image === 'scratch') return false
  // Only the part before a variable is knowable; a wholly dynamic reference or registry is not.
  const dynamicAt = image.search(/\$|\{\{/u)
  const known = dynamicAt === -1 ? image : image.slice(0, dynamicAt)
  if (known === '') return false
  if (dynamicAt !== -1 && !known.includes('/') && image.slice(dynamicAt).includes('/')) return false
  const [first = ''] = known.split('/')
  if (!known.includes('/')) return true
  if (HUB_HOSTS.includes(first)) return true
  return !(first.includes('.') || first.includes(':') || first === 'localhost')
}

const GLOBAL_VALUE_OPTIONS = new Set(
  '--config --context -c --host -H --log-level -l --tlscacert --tlscert --tlskey'.split(' '),
)

function dockerCommandImages(script: string): string[] {
  const logical = withoutShellComment(script).replace(/\\\r?\n/gu, ' ')
  return [...logical.matchAll(/\bdocker\s+([^\n;&|]*)/gu)].flatMap(([, command]) => {
    const tokens = command!.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/gu) ?? []
    let i = 0
    while (tokens[i]?.startsWith('-')) i += GLOBAL_VALUE_OPTIONS.has(tokens[i]!) ? 2 : 1
    if (tokens[i] === 'container' || tokens[i] === 'image') i++
    if (!['run', 'pull', 'create'].includes(tokens[i] ?? '')) return []
    for (i++; i < tokens.length; i++) {
      const token = tokens[i]!
      if (!token.startsWith('-')) return [token]
      if (VALUE_FLAGS.has(token)) i++
    }
    return []
  })
}

function stepImages(step: Step): string[] {
  const driverOptions = step.with?.['driver-opts']
  const driverImage = /(?:^|[\s,])image=(\S+)/u.exec(
    typeof driverOptions === 'string' ? driverOptions : '',
  )
  // setup-buildx-action's docker-container driver defaults to moby/buildkit from Docker Hub.
  const driver = step.with?.driver
  const defaultsToHub =
    step.uses?.startsWith('docker/setup-buildx-action') === true &&
    !driverImage &&
    (driver === undefined || driver === 'docker-container')
  return [
    ...dockerCommandImages(step.run ?? ''),
    ...(driverImage ? [driverImage[1]!] : []),
    ...(defaultsToHub ? ['moby/buildkit'] : []),
    ...(step.uses?.startsWith('docker://') ? [step.uses.slice('docker://'.length)] : []),
  ]
}

export function workflowImageViolations(
  path: string,
  document: Document,
  mirror = DEFAULT_MIRROR,
): string[] {
  const found: Array<[string, string]> = []
  for (const [jobId, job] of Object.entries(document.jobs ?? {})) {
    const container = typeof job.container === 'string' ? job.container : job.container?.image
    if (container) found.push([`${jobId} container`, container])
    for (const [name, service] of Object.entries(job.services ?? {})) {
      if (service.image) found.push([`${jobId} service ${name}`, service.image])
    }
    for (const step of job.steps ?? []) {
      found.push(...stepImages(step).map((image): [string, string] => [jobId, image]))
    }
  }
  const actionImage = document.runs?.image
  if (actionImage?.startsWith('docker://')) {
    found.push(['action image', actionImage.slice('docker://'.length)])
  }
  for (const step of document.runs?.steps ?? []) {
    found.push(...stepImages(step).map((image): [string, string] => ['composite', image]))
  }
  return found.flatMap(([where, image]) =>
    isHubImage(image) ? [`${path}#${where}: ${image} must come from ${mirror}/`] : [],
  )
}

export function dockerfileViolations(path: string, source: string): string[] {
  const stages = new Set<string>()
  const violations: string[] = []
  const syntax = /^#\s*syntax\s*=\s*(\S+)/imu.exec(source)?.[1]
  if (syntax && isHubImage(syntax)) violations.push(`${path}: # syntax=${syntax}`)
  for (const line of source.replace(/\\\r?\n/gu, ' ').split('\n')) {
    const copyFrom = /^\s*COPY\s+(?:--\S+\s+)*--from=(\S+)/iu.exec(line)?.[1]
    if (copyFrom && !/^\d+$/u.test(copyFrom) && !stages.has(copyFrom.toLowerCase())) {
      if (isHubImage(copyFrom)) violations.push(`${path}: COPY --from=${copyFrom}`)
    }
    const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/iu.exec(line)
    if (!from) continue
    if (!stages.has(from[1]!.toLowerCase()) && isHubImage(from[1]!)) {
      violations.push(`${path}: FROM ${from[1]}`)
    }
    if (from[2]) stages.add(from[2].toLowerCase())
  }
  return violations
}
