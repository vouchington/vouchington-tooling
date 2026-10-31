// One wall-clock deadline shared by the pnpm download and `pnpm install` phases.
// The first action step records the start (epoch ms) in SETUP_NODE_PNPM_STARTED_MS; every
// later phase gets only the time that remains.
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'
const DEFAULT_DEADLINE_SECONDS = '270'

export function parseDeadline(env, now = Date.now()) {
  const raw = (env.SETUP_NODE_PNPM_DEADLINE_SECONDS ?? '').trim() || DEFAULT_DEADLINE_SECONDS
  if (!/^[1-9]\d{0,5}$/u.test(raw)) {
    throw new Error(`deadline-seconds must be a positive integer up to 999999, got "${raw}"`)
  }
  const seconds = Number(raw)
  const started = Number((env.SETUP_NODE_PNPM_STARTED_MS ?? '').trim())
  const startedMs = Number.isSafeInteger(started) && started > 0 ? started : now
  return { seconds, endMs: startedMs + seconds * 1000 }
}

export function registryUrl(env) {
  return (env.npm_config_registry || env.NPM_CONFIG_REGISTRY || '').trim() || DEFAULT_REGISTRY
}

export function registryHost(env) {
  try {
    return new URL(registryUrl(env)).host
  } catch {
    return new URL(DEFAULT_REGISTRY).host
  }
}

export function deadlineMessage(seconds, phase, host) {
  return `setup-node-pnpm: deadline ${seconds}s exceeded during ${phase} (${host})`
}
