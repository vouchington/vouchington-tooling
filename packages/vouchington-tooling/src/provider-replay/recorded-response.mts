import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A provider response as it arrived on the wire: status, headers and the raw body bytes. */
export type RecordedResponse = {
  status: number
  statusText: string
  headers: Array<[name: string, value: string]>
  body: Buffer
}

/** Headers describing the original transfer framing; the replay serves the decoded body instead. */
const FRAMING_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
])

export type LoadRecordedResponseOptions = {
  /** Directory (path or `file:` URL) that holds the raw `.http` fixtures. */
  fixtureRoot: string | URL
  /** Literal tokens swapped in the whole file, for ids a test must keep unique. */
  replace?: Record<string, string>
}

/** Loads the raw `.http` fixture `<fixtureRoot>/<name>` and parses it. */
export function loadRecordedResponse(
  name: string,
  options: LoadRecordedResponseOptions,
): RecordedResponse {
  const { fixtureRoot } = options
  const root = typeof fixtureRoot === 'string' ? fixtureRoot : fileURLToPath(fixtureRoot)
  let raw = readFileSync(resolve(root, name)).toString('latin1')
  for (const [token, value] of Object.entries(options.replace ?? {})) {
    raw = raw.replaceAll(token, value)
  }
  return parseRecordedResponse(Buffer.from(raw, 'latin1'))
}

/** Parses raw HTTP response text: a status line, headers, a blank line, then the body bytes. */
export function parseRecordedResponse(raw: Buffer): RecordedResponse {
  const crlf = raw.indexOf('\r\n\r\n')
  const lf = raw.indexOf('\n\n')
  const useCrlf = crlf !== -1 && (lf === -1 || crlf < lf)
  const headEnd = useCrlf ? crlf : lf
  const head = headEnd === -1 ? raw : raw.subarray(0, headEnd)
  const body = headEnd === -1 ? Buffer.alloc(0) : raw.subarray(headEnd + (useCrlf ? 4 : 2))
  const [statusLine = '', ...headerLines] = head.toString('latin1').split(/\r?\n/)
  const status = /^HTTP\/\S+ (\d{3})(?: (.*))?$/.exec(statusLine)
  if (!status) throw new Error(`Recorded response has no HTTP status line: ${statusLine}`)
  const headers = headerLines.flatMap((line): Array<[string, string]> => {
    const colon = line.indexOf(':')
    const name = line.slice(0, colon).trim().toLowerCase()
    if (colon < 1 || FRAMING_HEADERS.has(name)) return []
    return [[name, line.slice(colon + 1).trim()]]
  })
  return { status: Number(status[1]), statusText: status[2] ?? '', headers, body }
}
