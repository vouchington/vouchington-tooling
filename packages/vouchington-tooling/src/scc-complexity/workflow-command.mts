export function escapeWorkflowCommandMessage(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
}

export function escapeWorkflowCommandProperty(value: string): string {
  return escapeWorkflowCommandMessage(value).replaceAll(':', '%3A').replaceAll(',', '%2C')
}
