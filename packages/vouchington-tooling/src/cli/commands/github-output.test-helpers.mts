export function parseGithubOutput(text: string): Record<string, string> {
  const outputs: Record<string, string> = {}
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line) continue

    const heredocSeparator = line.indexOf('<<')
    if (heredocSeparator !== -1) {
      const name = line.slice(0, heredocSeparator)
      const delimiter = line.slice(heredocSeparator + 2)
      const valueLines: string[] = []

      index += 1
      while (index < lines.length) {
        const next = lines[index]
        if (next === undefined || next === delimiter) break
        valueLines.push(next)
        index += 1
      }
      if (index === lines.length) throw new Error(`Missing output delimiter: ${delimiter}`)

      outputs[name] = valueLines.join('\n')
      continue
    }

    const assignmentSeparator = line.indexOf('=')
    if (assignmentSeparator === -1) throw new Error(`Invalid output record: ${line}`)
    outputs[line.slice(0, assignmentSeparator)] = line.slice(assignmentSeparator + 1)
  }

  return outputs
}
