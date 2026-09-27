const FUNCTION_DECLARATION_PATTERN =
  /\bfunction\s+([a-zA-Z_$][\w$]*)\s*\(([^)]*)\)\s*(?::[^{]+)?\{([\s\S]*?)\n\s*\}/g
const CALL_EXPRESSION_PATTERN = /\b([a-zA-Z_$][\w$]*)\s*\(([^)]*)\)/g
const ENV_MAP_DECLARATION_PATTERN = /^(\s*)(?:-\s*)?env\s*:\s*(?:#.*)?$/
const BLANK_OR_COMMENT_PATTERN = /^\s*(?:#.*)?$/
const UPPERCASE_YAML_KEY_PATTERN = /^\s*([A-Z][A-Z0-9_]*)\s*:/
const PROCESS_ENV_PARAM_PATTERN = /\bprocess\.env\[([a-zA-Z_$][\w$]*)\]/g
const IDENTIFIER_INDEXED_ACCESS_PATTERN = /\b([a-zA-Z_$][\w$]*)\[([a-zA-Z_$][\w$]*)\]/g

export function matchLocalEnvWrapperCallNames(
  source: string,
  envConstants: ReadonlyMap<string, string>,
): string[] {
  const envNameArgumentIndexes = findLocalEnvWrapperArgumentIndexes(source)
  if (envNameArgumentIndexes.size === 0) return []
  const names = new Set<string>()
  for (const match of source.matchAll(CALL_EXPRESSION_PATTERN)) {
    const functionName = match[1]!
    const envNameArgumentIndex = envNameArgumentIndexes.get(functionName)
    if (envNameArgumentIndex === undefined) continue
    const args = splitCallArguments(match[2] ?? '')
    const name = envNameFromArgument(args[envNameArgumentIndex], envConstants)
    if (name) names.add(name)
  }
  return [...names]
}

export function matchLocalEnvWrapperCallPrefixes(
  source: string,
  envConstants: ReadonlyMap<string, string>,
): string[] {
  const envNameArgumentIndexes = findLocalEnvWrapperArgumentIndexes(source)
  if (envNameArgumentIndexes.size === 0) return []
  const prefixes = new Set<string>()
  for (const match of source.matchAll(CALL_EXPRESSION_PATTERN)) {
    const functionName = match[1]!
    const envNameArgumentIndex = envNameArgumentIndexes.get(functionName)
    if (envNameArgumentIndex === undefined) continue
    const args = splitCallArguments(match[2] ?? '')
    const prefix = envNamePrefixFromArgument(args[envNameArgumentIndex], envConstants)
    if (prefix) prefixes.add(prefix)
  }
  return [...prefixes]
}

export function matchWorkflowEnvMapNames(source: string): string[] {
  const names = new Set<string>()
  const lines = source.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const envIndent = lines[index]!.match(ENV_MAP_DECLARATION_PATTERN)?.[1]?.length
    if (envIndent === undefined) continue
    collectEnvMapChildNames(lines, index, envIndent, names)
  }
  return [...names]
}

function findLocalEnvWrapperArgumentIndexes(source: string): Map<string, number> {
  const indexes = new Map<string, number>()
  for (const match of source.matchAll(FUNCTION_DECLARATION_PATTERN)) {
    const functionName = match[1]!
    const params = parseParameterNames(match[2] ?? '')
    const body = match[3] ?? ''
    const processEnvParams = new Set(
      [...body.matchAll(PROCESS_ENV_PARAM_PATTERN)].map((item) => item[1]!),
    )
    const indexedAccesses = new Set(
      [...body.matchAll(IDENTIFIER_INDEXED_ACCESS_PATTERN)].map((item) => `${item[1]}:${item[2]}`),
    )
    addProcessEnvWrapperIndexes(indexes, functionName, params, processEnvParams)
    addEnvObjectWrapperIndexes(indexes, functionName, params, indexedAccesses)
  }
  return indexes
}

function addProcessEnvWrapperIndexes(
  indexes: Map<string, number>,
  functionName: string,
  params: string[],
  processEnvParams: ReadonlySet<string>,
): void {
  for (const [index, param] of params.entries()) {
    if (processEnvParams.has(param)) indexes.set(functionName, index)
  }
}

function addEnvObjectWrapperIndexes(
  indexes: Map<string, number>,
  functionName: string,
  params: string[],
  indexedAccesses: ReadonlySet<string>,
): void {
  for (const [envIndex, envParam] of params.entries()) {
    for (const [nameIndex, nameParam] of params.entries()) {
      if (envIndex === nameIndex) continue
      if (indexedAccesses.has(`${envParam}:${nameParam}`)) indexes.set(functionName, nameIndex)
    }
  }
}

function parseParameterNames(parameters: string): string[] {
  return splitCallArguments(parameters).flatMap((parameter) => {
    const name = parameter.trim().match(/^([a-zA-Z_$][\w$]*)\b/)?.[1]
    return name ? [name] : []
  })
}

function splitCallArguments(args: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let quote = ''
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index]!
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = ''
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char
    } else if ('<[{('.includes(char)) {
      depth += 1
    } else if ('>]})'.includes(char)) {
      depth = Math.max(0, depth - 1)
    } else if (char === ',' && depth === 0) {
      parts.push(args.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(args.slice(start).trim())
  return parts
}

function envNameFromArgument(
  arg: string | undefined,
  envConstants: ReadonlyMap<string, string>,
): string | null {
  if (!arg) return null
  const literal = arg.match(/^['"]([A-Z][A-Z0-9_]*)['"]$/)?.[1]
  if (literal) return literal
  return envConstants.get(arg) ?? null
}

function envNamePrefixFromArgument(
  arg: string | undefined,
  envConstants: ReadonlyMap<string, string>,
): string | null {
  const prefixConstant = arg?.match(/^`\$\{([A-Z0-9_]+)\}/)?.[1]
  return prefixConstant ? (envConstants.get(prefixConstant) ?? null) : null
}

function collectEnvMapChildNames(
  lines: string[],
  envLineIndex: number,
  envIndent: number,
  names: Set<string>,
): void {
  let keyIndent: number | null = null
  for (let childIndex = envLineIndex + 1; childIndex < lines.length; childIndex += 1) {
    const line = lines[childIndex]!
    if (BLANK_OR_COMMENT_PATTERN.test(line)) continue
    const indent = line.match(/^\s*/)![0].length
    if (indent <= envIndent) break
    keyIndent ??= indent
    if (indent !== keyIndent) continue
    const name = line.match(UPPERCASE_YAML_KEY_PATTERN)?.[1]
    if (name) names.add(name)
  }
}
