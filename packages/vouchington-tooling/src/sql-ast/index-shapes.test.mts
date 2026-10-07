import { beforeAll, describe, expect, it } from 'vitest'
import { extractIndexShapes, initSqlAst } from './index.mts'

describe('extractIndexShapes', () => {
  beforeAll(() => initSqlAst())

  it('returns no shapes for blank SQL', () => {
    expect(extractIndexShapes('')).toEqual([])
    expect(extractIndexShapes('   ')).toEqual([])
  })

  it('throws for malformed SQL', () => {
    expect(() => extractIndexShapes('CREATE INDEX (')).toThrow('syntax error')
    expect(() =>
      extractIndexShapes('CREATE INDEX idx_a ON sample (owner_id); CREATE TABLE ('),
    ).toThrow('syntax error')
    expect(() => extractIndexShapes('DO $$ BEGIN;')).toThrow()
  })

  it('skips anonymous indexes and indexes nested inside DO blocks', () => {
    const sql = `
      CREATE INDEX ON "sample" (owner_id);
      DO $$
      BEGIN
        CREATE INDEX IF NOT EXISTS idx_inside ON "sample" (owner_id);
      END $$;
    `
    expect(extractIndexShapes(sql)).toEqual([])
  })

  it('treats generated nested conditionals, locks, and indexes as one opaque DO block', () => {
    const sql = `
      CREATE INDEX idx_top ON sample (owner_id);
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relation_fkey') THEN
          LOCK TABLE child IN SHARE ROW EXCLUSIVE MODE;
          LOCK TABLE child_relations IN SHARE ROW EXCLUSIVE MODE;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relation_fkey') THEN
            CREATE INDEX IF NOT EXISTS idx_inside ON sample (owner_id);
          END IF;
        END IF;
      END $$;
    `
    expect(extractIndexShapes(sql).map(({ idxname }) => idxname)).toEqual(['idx_top'])
  })

  it('uses the same shape for differently named identical definitions', () => {
    const shapes = extractIndexShapes(`
      CREATE INDEX IF NOT EXISTS idx_a ON "sample" (owner_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_b ON "sample" (owner_id) WHERE deleted_at IS NULL;
    `)
    expect(shapes.map(({ idxname }) => idxname)).toEqual(['idx_a', 'idx_b'])
    expect(shapes.map(({ table }) => table)).toEqual(['sample', 'sample'])
    expect(shapes[0]?.shapeKey).toBe(shapes[1]?.shapeKey)
  })

  it('distinguishes different columns', () => {
    const shapes = extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id);
      CREATE INDEX idx_b ON sample (group_id);
    `)
    expect(shapes[0]?.shapeKey).not.toBe(shapes[1]?.shapeKey)
  })

  it('normalizes implicit and explicit ASC', () => {
    const shapes = extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id);
      CREATE INDEX idx_b ON sample (owner_id ASC);
    `)
    expect(shapes[0]?.shapeKey).toBe(shapes[1]?.shapeKey)
  })

  it('normalizes redundant predicate parentheses', () => {
    const shapes = extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id) WHERE (deleted_at IS NULL);
      CREATE INDEX idx_b ON sample (owner_id) WHERE ((deleted_at IS NULL));
    `)
    expect(shapes[0]?.shapeKey).toBe(shapes[1]?.shapeKey)
  })

  it('resolves implicit null ordering for ascending and descending indexes', () => {
    const ascending = extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id);
      CREATE INDEX idx_b ON sample (owner_id NULLS LAST);
    `)
    const descending = extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id DESC);
      CREATE INDEX idx_b ON sample (owner_id DESC NULLS FIRST);
    `)
    expect(ascending[0]?.shapeKey).toBe(ascending[1]?.shapeKey)
    expect(descending[0]?.shapeKey).toBe(descending[1]?.shapeKey)
  })

  it('distinguishes ascending and descending indexes', () => {
    const shapes = extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id ASC);
      CREATE INDEX idx_b ON sample (owner_id DESC);
    `)
    expect(shapes[0]?.shapeKey).not.toBe(shapes[1]?.shapeKey)
  })
})
