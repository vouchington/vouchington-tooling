export const optimizerProgressPattern = /\[optimizer\] (?:scanning|bundling) dependencies/
export const viteServerFetchFailurePattern =
  /Failed to fetch dynamically imported module: http:\/\/localhost:\d+\//
export const viteServerScriptNetworkChangePattern =
  /\[PW Error\] script request failed for http:\/\/localhost:\d+\/\S+ url: net::ERR_NETWORK_CHANGED/

// Runner-missing detection latches two independent markers (see hasAddonVitestSetupFile and
// vitestRunnerMissingMarker). They are matched separately, never as one regex spanning both,
// because the full "Failed to import test file ... Vitest failed to find the runner" error block
// is larger than the rolling output window, so the two ends cannot co-occur in one snapshot.
const addonVitestSetupFilePathMarker = '/@storybook/addon-vitest/'
const addonVitestSetupFileNameMarker = '/vitest-plugin/setup-file.js'
export const vitestRunnerMissingMarker = 'Vitest failed to find the runner'

export type ProjectOutputPatterns = {
  /** Matches the browser-session connection timeout message for the project. */
  connectionTimeout: RegExp
  /** Marker that prefixes every test line of the browser project. */
  projectMarker: string
  /** Matches the browser project's output or the Vitest summary. */
  testOutput: RegExp
}

export function createProjectOutputPatterns(projectName: string): ProjectOutputPatterns {
  const name = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return {
    connectionTimeout: new RegExp(
      `Failed to connect to the browser session "[^"]+" \\[${name} \\(chromium\\)\\] within the timeout\\.`,
    ),
    projectMarker: `|${projectName}`,
    testOutput: new RegExp(`\\|${name}|\\n\\s*(?:[✓✗✘] )?Test Files\\s+`),
  }
}

// The add-on setup-file path (the package segment and the file segment) is checked against the
// current chunk and the sliding buffer, so it latches whether the block arrives as one oversized
// write or is split across chunks. The two segments always co-locate on one path line.
export function hasAddonVitestSetupFile(plainText: string, plainOutputBuffer: string): boolean {
  const hasBoth = (haystack: string) =>
    haystack.includes(addonVitestSetupFilePathMarker) &&
    haystack.includes(addonVitestSetupFileNameMarker)
  return hasBoth(plainText) || hasBoth(plainOutputBuffer)
}
