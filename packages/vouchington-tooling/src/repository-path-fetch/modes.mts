export function recordGitMode(
  modes: Map<string, string>,
  destination: string,
  sourceMode: string,
): void {
  const mode = sourceMode === '100755' ? '0755' : '0644'
  const previous = modes.get(destination)
  if (previous) throw new Error(`duplicate bundle destination: ${destination}`)
  modes.set(destination, mode)
}
