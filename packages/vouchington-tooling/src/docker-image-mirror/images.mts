import { withoutShellComment } from '../trivy-policy/shell.mts'
import { DEFAULT_MIRROR, imageReasons, policyActive, type ImagePolicy } from './policy.mts'

export { DEFAULT_MIRROR } from './policy.mts'

// Unauthenticated Docker Hub pulls from hosted runners hit its rate limit. A pull-through mirror
// serves the same pinned digest without credentials, so every image must name a non-Hub registry.
// Shell scripts are not workflow bodies and are outside this scan.
const VALUE_FLAGS = new Set(
  '-e --env -p --publish -v --volume --name --network --net --add-host --entrypoint -u --user -w --workdir --tmpfs --platform --mount --label -l --env-file --health-cmd --health-interval --health-retries --health-timeout --health-start-period -m --memory --cpus --restart --cap-add --cap-drop --shm-size --log-driver --ulimit -h --hostname --pull --pids-limit --group-add --device --dns --ipc --pid --cgroupns --stop-signal --stop-timeout --gpus --cidfile --link --volumes-from --cpuset-cpus --cpu-shares --cgroup-parent --dns-search --dns-option --ip --ip6 --mac-address --blkio-weight --memory-swap --memory-reservation --kernel-memory --oom-score-adj --runtime --security-opt --sysctl --userns --uts --annotation --network-alias --expose --label-file --isolation --log-opt --storage-opt --cpu-quota --cpu-period --domainname --detach-keys -a --attach --cpuset-mems --device-cgroup-rule'.split(
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
  policy: ImagePolicy = {},
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
  return found.flatMap(([where, image]) => {
    const reasons = imageReasons(image, mirror, policy)
    return reasons.length > 0 ? [`${path}#${where}: ${image} ${reasons.join('; ')}`] : []
  })
}

export function dockerfileViolations(
  path: string,
  source: string,
  policy: ImagePolicy = {},
  mirror = DEFAULT_MIRROR,
): string[] {
  const stages = new Set<string>()
  const violations: string[] = []
  const check = (label: string, image: string): void => {
    const reasons = imageReasons(image, mirror, policy)
    if (reasons.length === 0) return
    violations.push(`${path}: ${label}${policyActive(policy) ? ` ${reasons.join('; ')}` : ''}`)
  }
  const syntax = /^#\s*syntax\s*=\s*(\S+)/imu.exec(source)?.[1]
  if (syntax) check(`# syntax=${syntax}`, syntax)
  for (const line of source.replace(/\\\r?\n/gu, ' ').split('\n')) {
    const copyFrom = /^\s*COPY\s+(?:--\S+\s+)*--from=(\S+)/iu.exec(line)?.[1]
    if (copyFrom && !/^\d+$/u.test(copyFrom) && !stages.has(copyFrom.toLowerCase())) {
      check(`COPY --from=${copyFrom}`, copyFrom)
    }
    const from = /^\s*FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?/iu.exec(line)
    if (!from) continue
    if (!stages.has(from[1]!.toLowerCase())) check(`FROM ${from[1]}`, from[1]!)
    if (from[2]) stages.add(from[2].toLowerCase())
  }
  return violations
}
