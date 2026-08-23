import { describe, expect, it } from 'vitest'

import { isSwiftCodeOffset, parseUniqueSwiftBinaryTargetChecksum } from './index.mts'

const checksum = 'a'.repeat(64)
const url = 'https://example.test/skip.zip'
const line = `    package.targets += [.binaryTarget(name: "skip", url: "${url}", checksum: "${checksum}")]`

describe('swift source offset', () => {
  it('parses a unique live binaryTarget checksum', () => {
    expect(parseUniqueSwiftBinaryTargetChecksum(`${line}\n`, 'skip', url)).toBe(checksum)
  })

  it('ignores checksums inside comments and strings', () => {
    expect(parseUniqueSwiftBinaryTargetChecksum(`// ${line}\n`, 'skip', url)).toBeUndefined()
    expect(parseUniqueSwiftBinaryTargetChecksum(`/* ${line} */\n`, 'skip', url)).toBeUndefined()
  })

  it('rejects duplicate live matches', () => {
    expect(parseUniqueSwiftBinaryTargetChecksum(`${line}\n${line}\n`, 'skip', url)).toBeUndefined()
  })

  it('treats offsets inside comments and strings as non-code', () => {
    expect(isSwiftCodeOffset('// comment without newline', 12)).toBe(false)
    expect(isSwiftCodeOffset('//\nlet x = 1', 3)).toBe(true)
    expect(isSwiftCodeOffset('let s = "\\n"', 11)).toBe(false)
    expect(isSwiftCodeOffset('/* /* nested */ still */let x', 5)).toBe(false)
    expect(isSwiftCodeOffset('/* /* nested */ */x', 19)).toBe(true)
    expect(isSwiftCodeOffset('let s = """hi""" + y', 20)).toBe(true)
    expect(isSwiftCodeOffset('let s = """\nhi\n"""', 12)).toBe(false)
    expect(isSwiftCodeOffset('let s = "a\\"b"', 11)).toBe(false)
    expect(isSwiftCodeOffset('let s = "hi"', 9)).toBe(false)
  })
})
