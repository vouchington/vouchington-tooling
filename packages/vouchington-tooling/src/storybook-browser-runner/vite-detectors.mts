const ansiEscapePattern = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'g')

const NEW_DEPENDENCIES_MARKER = 'new dependencies found:'
const OPTIMIZER_RELOAD_MARKER = 'optimized dependencies changed. reloading'

export const stripAnsi = (log: string): string => log.replace(ansiEscapePattern, '')

export const hasStorybookBrowserViteDependencyReady = (plainLog: string): boolean =>
  plainLog.includes('dependencies optimized') || /\bhash is consistent\b/i.test(plainLog)

export const hasStorybookBrowserViteReady = (plainLog: string): boolean =>
  hasStorybookBrowserViteDependencyReady(plainLog) ||
  /VITE v\d+\.\d+\.\d+\s*ready in \d+\s*ms/.test(plainLog)

export const hasStorybookViteNewDependenciesFound = (plainLog: string): boolean =>
  plainLog.includes(NEW_DEPENDENCIES_MARKER)

export const hasStorybookViteOptimizerReload = (plainLog: string): boolean =>
  plainLog.includes(OPTIMIZER_RELOAD_MARKER)

export const parseStorybookViteNewDependencies = (plainLog: string): string[] => {
  const names = new Set<string>()
  for (const match of plainLog.matchAll(/new dependencies found:\s*([^\n]+)/g)) {
    for (const name of (match[1] ?? '').split(',')) {
      const trimmed = name.trim()
      if (trimmed) names.add(trimmed)
    }
  }
  return [...names]
}
