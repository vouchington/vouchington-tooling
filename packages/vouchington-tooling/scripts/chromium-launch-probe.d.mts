export interface LaunchedBrowser {
  close(): Promise<void>
}

export type BrowserLauncher = () => Promise<LaunchedBrowser>

export function chromiumLaunchProbeExitCode(launches: readonly BrowserLauncher[]): Promise<0 | 1>
