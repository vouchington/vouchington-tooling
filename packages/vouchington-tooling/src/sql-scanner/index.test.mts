import { describe, expect, it } from 'vitest'

import {
  dollarQuoteEnd,
  lineOf,
  maskSqlQuotedText,
  readDollarQuoteDelimiter,
  readStringLiteral,
  sqlFragments,
  splitSqlStatements,
  stripSqlComments,
} from './index.mts'

describe('sql-scanner', () => {
  it('strips comments while preserving quoted SQL text and line offsets', () => {
    const content =
      "SELECT 'keep -- text', $$keep /* text */$$;\n" +
      '-- comment line\n' +
      '/* block comment */\n' +
      'SELECT 1;\n'

    const stripped = stripSqlComments(content)
    const masked = maskSqlQuotedText(stripped)

    expect(stripped).toContain("'keep -- text'")
    expect(stripped).toContain('$$keep /* text */$$')
    expect(stripped).not.toContain('comment line')
    expect(masked).toContain('SELECT 1;')
    expect(masked).not.toContain('keep /* text */')
    expect(lineOf(stripped, stripped.indexOf('SELECT 1'))).toBe(4)
  })

  it('splits statements without splitting quoted semicolons', () => {
    const statements = splitSqlStatements("SELECT 'a;';\nSELECT $$b;$$;\nSELECT 'c''d';\n").map(
      (statement) => statement.text.trim(),
    )

    expect(statements).toEqual(["SELECT 'a;'", 'SELECT $$b;$$', "SELECT 'c''d'"])
  })

  it('reads string literals and dollar-quoted fragments', () => {
    expect(readStringLiteral(String.raw`E'line\n'`, 0)).toMatchObject({
      text: 'line\n',
      index: 2,
      end: 9,
    })
    expect(dollarQuoteEnd('prefix $tag$body$tag$ suffix', 12, '$tag$')).toBe(16)
    expect(sqlFragments("SELECT 'foo''bar', $tag$baz$tag$;")).toEqual([
      { text: "foo'bar", index: 8 },
      { text: 'baz', index: 24 },
    ])
  })

  it('computes line numbers from character offsets', () => {
    expect(lineOf('a\nb\nc', 0)).toBe(1)
    expect(lineOf('a\nb\nc', 2)).toBe(2)
    expect(lineOf('a\nb\nc', 4)).toBe(3)
  })

  it('handles Unicode string literals during comment stripping and statement splitting', () => {
    const content = "SELECT U&'keep -- text';\nSELECT 1;\n"
    const stripped = stripSqlComments(content)

    expect(stripped).toContain("U&'keep -- text'")
    expect(splitSqlStatements(stripped).map((statement) => statement.text.trim())).toEqual([
      "SELECT U&'keep -- text'",
      'SELECT 1',
    ])
  })

  it('strips a trailing line comment with no newline and nested block comments', () => {
    expect(stripSqlComments('SELECT 1 -- tail')).toMatch(/SELECT 1\s+$/)
    expect(stripSqlComments('SELECT /* outer /* inner */ still */ 2')).toContain('SELECT')
    expect(stripSqlComments("SELECT E'keep -- text';").trim()).toBe("SELECT E'keep -- text';")
  })

  it('splits a trailing statement without a semicolon', () => {
    expect(splitSqlStatements('SELECT 1').map((statement) => statement.text.trim())).toEqual([
      'SELECT 1',
    ])
    expect(
      splitSqlStatements("SELECT E'a;b'; SELECT 2").map((statement) => statement.text.trim()),
    ).toEqual(["SELECT E'a;b'", 'SELECT 2'])
  })

  it('returns no fragments when a dollar quote never closes', () => {
    expect(sqlFragments('SELECT $tag$unterminated')).toEqual([])
  })

  it('preserves doubled quotes and escape sequences while stripping comments', () => {
    expect(stripSqlComments("SELECT 'it''s fine' -- x")).toContain("'it''s fine'")
    expect(stripSqlComments("SELECT E'a\\nb'")).toContain("E'a\\nb'")
    expect(readStringLiteral("E'a\\t'", 0)?.text).toBe('a\t')
    expect(readStringLiteral("'abc", 0)?.end).toBe(5)
    expect(stripSqlComments('SELECT /* unterminated').startsWith('SELECT')).toBe(true)
    expect(
      splitSqlStatements("SELECT E'a\\;b';").map((statement) => statement.text.trim()),
    ).toEqual(["SELECT E'a\\;b'"])
    expect(maskSqlQuotedText("SELECT E'keep -- x'")).not.toContain('keep')
    expect(maskSqlQuotedText("SELECT E'a\\nb'")).toContain('SELECT')
    expect(maskSqlQuotedText("SELECT 'it''s'")).toContain('SELECT')
    expect(readDollarQuoteDelimiter('a$tag$', 1)).toBeNull()
    expect(readDollarQuoteDelimiter(' $tag$', 1)).toBe('$tag$')
    expect(maskSqlQuotedText('SELECT $$keep$$')).not.toContain('keep')
  })
})
