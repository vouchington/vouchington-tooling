export function recordGitMode(
  modes: Map<string, string>,
  destination: string,
  sourceMode: string,
): void {
  const mode = sourceMode === '100755' ? '0755' : '0644'
  const previous = modes.get(destination)
  if (previous && previous !== mode) throw new Error(`conflicting Git modes: ${destination}`)
  modes.set(destination, mode)
}
