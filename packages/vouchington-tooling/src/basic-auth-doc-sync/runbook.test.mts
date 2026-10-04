import { describe, expect, it } from 'vitest'
import { findRunbookExemptRoutes } from './index.mts'

const table =
  '| Path | Methods | Caller |\n| --- | --- | --- |\n' +
  '| `/status` | `GET`, `HEAD` | probe |\n| `/service` | `POST` | client |'
const expected = [
  { path: '/status', methods: ['GET', 'HEAD'] },
  { path: '/service', methods: ['POST'] },
]

describe('basic-auth runbook facts', () => {
  it('extracts the configured heading with case-insensitive column labels', () => {
    expect(findRunbookExemptRoutes('### Public routes\n\n' + table, 'Public routes')).toEqual(
      expected,
    )
    expect(
      findRunbookExemptRoutes(
        '### PUBLIC ROUTES\r\n\r\n' + table.replaceAll('\n', '\r\n'),
        'Public routes',
      ),
    ).toEqual(expected)
    expect(findRunbookExemptRoutes('### Different\n\n' + table, 'Public routes')).toBeNull()
  })

  it('accepts reordered columns and short Markdown separators', () => {
    expect(
      findRunbookExemptRoutes(
        '### Routes\n\n| methods | PATH |\n| - | - |\n| `GET` | `/status` |',
        'Routes',
      ),
    ).toEqual([{ path: '/status', methods: ['GET'] }])
  })

  it.each([
    '| Path | Methods |\n| --- | missing |\n| `/status` | `GET` |',
    '| Path | Methods |\n| --- |\n| `/status` | `GET` |',
    '| Path | Methods |\n| --- | --- |',
    '| Path | Verbs |\n| - | - |\n| `/status` | `GET` |',
    '| Path | Methods |\n| - | - |\n| `` | `GET` |',
    '| Path | Methods |\n| - | - |\n| `/status` | |',
    '| Path | Methods |\n| - | - |\n| `/status` |',
    '| URL | Methods |\n| --- | --- |\n| `/status` | `GET` |',
    '| Path | Methods |\n| --- | --- |\n| /status | `GET` |',
    '| Path | Methods |\n| --- | --- |\n| `/status` | GET |',
    '| Path | Methods |\n| --- | --- |\n| `/status` | `GET` or `POST` |',
    '| Path | Methods |\n| --- | --- |\n| `/status` | `get` |',
    '| Path | Methods |\n| --- | --- |\n| `/status` | `GET ` |',
  ])('rejects malformed tables or method cells: %s', (invalid) => {
    expect(findRunbookExemptRoutes('### Routes\n\n' + invalid, 'Routes')).toBeNull()
  })

  it('preserves duplicate rows for repository-specific comparison diagnostics', () => {
    const duplicate =
      '### Routes\n\n| Path | Methods |\n| - | - |\n| `/status` | `GET` |\n| `/status` | `HEAD` |'
    expect(findRunbookExemptRoutes(duplicate, 'Routes')).toEqual([
      { path: '/status', methods: ['GET'] },
      { path: '/status', methods: ['HEAD'] },
    ])
  })
})
