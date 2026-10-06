import { describe, expect, it } from 'vitest'
import { sourceImportsAndComposesAny } from './composes.mts'
import { sourceImportsAndUsesBoundaryAny } from './composition.mts'
import { sourceFiltersWithPublicBoundary } from './public-boundary.mts'
import type { ReaderSourceAnalysisOptions } from './source-options.mts'
const options: ReaderSourceAnalysisOptions = {
  canonicalImports: new Map([
    ['buildFilter', new Set(['@fixture/builders'])],
    ['buildAccess', new Set(['./access.mts'])],
    ['buildPublicFilter', new Set(['@fixture/builders'])],
    ['collectVisibleIds', new Set(['@fixture/boundary'])],
    ['loadDescendants', new Set(['@fixture/descendants'])],
    ['loadVisibleDescendants', new Set(['./visible-ids.mts'])],
  ]),
  sql: {
    templateTag: 'sql',
    appendMethod: 'append',
    placeholderPrefix: 'fixture_',
    executorImports: new Map([
      ['@fixture/database', new Set(['read', 'write', 'query', 'readStream', 'explainAnalyze'])],
    ]),
  },
  ignoredCall: 'ignore',
  candidateIdProperty: 'id',
}

const builder = "import {buildFilter as build} from '@fixture/builders';"
const boundary = "import {collectVisibleIds as collect} from '@fixture/boundary';"
describe('existing reader source shapes', () => {
  it.each([
    ['return build()', true],
    ['const value=build(); consume(value)', true],
    ['const value=build(); value.length', true],
    ['Promise.all([build()])', true],
    ['build().then(consume)', true],
    ['ignore(build())', false],
    ['consume(build())', true],
    ['consume[42](build())', false],
    ['const {ids}=await build(); respond(ids)', true],
    ['const value=build(); return value', true],
  ])('boundary result %s', (source, expected) =>
    expect(sourceImportsAndUsesBoundaryAny(builder + source, ['buildFilter'], options)).toBe(
      expected,
    ),
  )
  it.each([
    ['const values=[];values.push(build());for(const value of values)consume(value)', true],
    ['const value=build(); value.consume()', false],
    ['consume(build())', false],
    ['const value=build();const values=[];values.push(value);return values', true],
    [
      "import {read as execute} from '@fixture/database';const q=sql`SELECT 1`;q.append(build());execute(q)",
      true,
    ],
    [
      "import {read,write} from '@fixture/database';const run=flag?read:write;const q=sql`SELECT 1`;q.append(build());run(q)",
      true,
    ],
    [
      "import * as db from '@fixture/database';const q=sql`SELECT 1`;q.append(build());db.read(q)",
      false,
    ],
    ['const values=[];values.push(build());ignore(values)', true],
    ['external.push(build())', false],
    ['for(const value of [build()])consume(value)', false],
    ['let value=build(); ({value}=other);return value', true],
    ['const q=sql`SELECT 1`;q.append(q);return build()', true],
    ['build();make().consume();return null', false],
    ['const q=sql`SELECT 1`;q.append(value);const value=build();return q', false],
    ['const holes=[,,];return build()', true],

    ['const value=build();external.push(value)', false],
  ])('builder composition %s', (source, expected) =>
    expect(sourceImportsAndComposesAny(builder + source, ['buildFilter'], options)).toBe(expected),
  )
  it.each([
    ['return collect(ids)', true],
    ['const ids=await collect(values);return ids', true],
    ['function local(){const ids=collect(values);return rows.filter(row=>ids.has(row.id))}', true],
    [
      'const ids=collect(values);const derived=rows.filter(row=>ids.has(row.id));for(const row of derived)consume(row)',
      true,
    ],
    [
      'const ids=collect(values);const derived=rows.filter(row=>ids.has(row.id));return derived.map(row=>row.id)',
      true,
    ],
    ['const ids=collect(values);holder.rows=rows.filter(row=>ids.has(row.id))', true],
    [
      'const ids=collect(values);let selected;selected=rows.filter(row=>ids.has(row.id));return selected',
      true,
    ],
    ['const ids=collect(values);rows.filter(row=>ids.has(row.id));return rows', false],
    ['const ids=collect(values);if(ids.has(row.id))consume(row)', false],
    ['const ids=collect(values);function unused(){ids.has(row.id)}return rows', false],
    ['const ids=collect(values);rows.filter(row=>consume(()=>ids.has(row.id)));return rows', false],
    ['function standalone(ids){return rows.filter(row=>ids.has(row.id))}', false],
    ['collect(values).map(ids=>rows.filter(row=>ids.has(row.id)))', false],
    ['const notIds=[];return rows.filter(row=>notIds.has(row.id))', false],
    ['const ids=collect(values);if(consume(ids.has(row.id)))log(row)', false],
    ['consume(ids=>rows.filter(row=>ids.has(row.id)))', false],
    [
      'function outer(){ const ids=collect(values); return rows.filter(row=>ids.has(row.id)) }',
      true,
    ],
    ['const ids=collect(values);return rows.filter(row=>{return (()=>ids.has(row.id))()})', false],
    ['const ids=collect(values);return rows.filter(row=>ids.has(row.other))', false],
    ['const {ids}=collect(values);return rows', false],
    ['const ids=collect(values);(function(){consume(()=>ids.has(row.id))})()', false],
    [
      'const ids=collect(values);(class Holder { method(){ consume(()=>ids.has(row.id)) } })',
      false,
    ],
    ['const ids=collect(values);return rows[(() => ids.has(row.id))()]', false],
    ['const ids=collect(values);return rows.filter((row)=> { return ids.has(row.id) })', true],
    ['const ids=collect(values);consume(rows.filter(row=>ids.has(row.id)))', false],
    [
      'const ids=collect(values);const filtered=rows.filter(row=>ids.has(row.id));void filtered.filter;return rows',
      false,
    ],
    ['const ids=collect(values);return rows.filter(row=>()=>ids.has(row.id))', false],
    ['const ids=collect(values);assert(ids.has(row.id))', true],
    ['const ids=collect(values);return rows.filter(ids.has(row.id))', false],
    ['consume(ids=>{return rows.filter(row=>ids.has(row.id))})', false],
    ['const ids=collect(values);return rows.filter(row=>ids.has())', false],
    [
      'const ids=collect(values);({visible}=rows.filter(row=>ids.has(row.id)));return visible',
      false,
    ],
    [
      'const ids=collect(values);const [visible]=rows.filter(row=>ids.has(row.id));return visible',
      false,
    ],
    [
      'const ids=collect(values);const filtered=rows.filter(row=>ids.has(row.id));filtered.map;return rows',
      false,
    ],
    [
      'const ids=collect(values);const filtered=rows.filter(row=>ids.has(row.id));const [mapped]=filtered.map(row=>row.id);return mapped',
      false,
    ],
    [
      'const ids=collect(values);return rows.filter(row=>{if(ids.has(row.id))consume(row);return true})',
      false,
    ],
    ['const holes=[,,];return collect(values)', true],
    [
      'const ids=collect(values);const filtered=rows.filter(row=>ids.has(row.id));let mapped;mapped=filtered.map(row=>row.id);return mapped',
      false,
    ],
  ])('public ID consumption %s', (source, expected) =>
    expect(sourceFiltersWithPublicBoundary(boundary + source, ['collectVisibleIds'], options)).toBe(
      expected,
    ),
  )
  it.each([
    sourceImportsAndComposesAny,
    sourceImportsAndUsesBoundaryAny,
    sourceFiltersWithPublicBoundary,
  ])('strict parser and missing import policy', (analyze) => {
    expect(() => analyze('const =', ['buildFilter'], options)).toThrow()
    expect(
      analyze(
        "import {buildFilter} from '@fixture/wrong'; return buildFilter()",
        ['buildFilter'],
        options,
      ),
    ).toBe(false)
  })
})
