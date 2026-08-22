import { once } from 'node:events'

import { describe, expect, it } from 'vitest'

import { escapeSpreadsheetFormula, parseCsvRows, streamCsvRows, stripCsvBom } from './index.mts'

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  stream.on('data', (chunk) => chunks.push(Buffer.from(chunk as Uint8Array)))
  await once(stream, 'end')
  return Buffer.concat(chunks).toString('utf8')
}

describe('csv', () => {
  it('strips only a leading UTF-8 BOM', () => {
    expect(stripCsvBom('\ufeffname\nvalue')).toBe('name\nvalue')
    expect(stripCsvBom(`name\n\ufeffvalue`)).toBe(`name\n\ufeffvalue`)
    expect(stripCsvBom('')).toBe('')
  })

  it('parses strict header-based rows and skips empty lines', () => {
    expect(parseCsvRows('\ufeffname,count\n alpha , 2\n\n')).toEqual([
      { name: 'alpha', count: '2' },
    ])
    expect(() => parseCsvRows('name,count\nalpha\n')).toThrow()
  })

  it.each(['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '\tformula', '\rformula'])(
    'escapes spreadsheet-active cell %j',
    (value) => {
      expect(escapeSpreadsheetFormula(value)).toBe(`'${value}`)
    },
  )

  it('leaves ordinary values unchanged and normalizes nullish cells', () => {
    expect(escapeSpreadsheetFormula('ordinary')).toBe('ordinary')
    expect(escapeSpreadsheetFormula(null)).toBe('')
    expect(escapeSpreadsheetFormula(undefined)).toBe('')
  })

  it('streams explicitly ordered columns with formula protection', async () => {
    const output = await readStream(
      streamCsvRows(
        [
          { ignored: 'not emitted', second: '=1+1', first: 'alpha' },
          { first: 'beta', second: null },
        ],
        ['first', 'second'],
      ),
    )
    expect(output).toBe("first,second\nalpha,'=1+1\nbeta,\n")
  })

  it('keeps stream errors observable to callers', async () => {
    const stream = streamCsvRows([], ['value'])
    const error = new Error('consumer stopped')
    const observed = new Promise<Error>((resolve) => stream.once('error', resolve))
    stream.destroy(error)
    await expect(observed).resolves.toBe(error)
  })
})
