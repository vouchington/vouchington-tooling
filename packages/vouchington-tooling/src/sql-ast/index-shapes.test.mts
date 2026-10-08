import { describe, expect, it } from 'vitest'
import { extractIndexShapes } from './index.mts'

describe('extractIndexShapes', () => {
  it('returns no shapes for blank SQL', async () => {
    expect(await extractIndexShapes('')).toEqual([])
    expect(await extractIndexShapes('   ')).toEqual([])
  })

  it('throws for malformed SQL', async () => {
    await expect(extractIndexShapes('CREATE INDEX (')).rejects.toThrow('syntax error')
    await expect(
      extractIndexShapes('CREATE INDEX idx_a ON sample (owner_id); CREATE TABLE ('),
    ).rejects.toThrow('syntax error')
    await expect(extractIndexShapes('DO $$ BEGIN;')).rejects.toThrow()
  })

  it('skips anonymous indexes and indexes nested inside DO blocks', async () => {
    const sql = `
      CREATE INDEX ON "sample" (owner_id);
      DO $$
      BEGIN
        CREATE INDEX IF NOT EXISTS idx_inside ON "sample" (owner_id);
      END $$;
    `
    expect(await extractIndexShapes(sql)).toEqual([])
  })

  it('treats generated nested conditionals, locks, and indexes as one opaque DO block', async () => {
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
    expect((await extractIndexShapes(sql)).map(({ idxname }) => idxname)).toEqual(['idx_top'])
  })

  it('uses the same shape for differently named identical definitions', async () => {
    const shapes = await extractIndexShapes(`
      CREATE INDEX IF NOT EXISTS idx_a ON "sample" (owner_id) WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_b ON "sample" (owner_id) WHERE deleted_at IS NULL;
    `)
    expect(shapes.map(({ idxname }) => idxname)).toEqual(['idx_a', 'idx_b'])
    expect(shapes.map(({ table }) => table)).toEqual(['sample', 'sample'])
    expect(shapes[0]?.shapeKey).toBe(shapes[1]?.shapeKey)
  })

  it('distinguishes different columns', async () => {
    const shapes = await extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id);
      CREATE INDEX idx_b ON sample (group_id);
    `)
    expect(shapes[0]?.shapeKey).not.toBe(shapes[1]?.shapeKey)
  })

  it('normalizes implicit and explicit ASC', async () => {
    const shapes = await extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id);
      CREATE INDEX idx_b ON sample (owner_id ASC);
    `)
    expect(shapes[0]?.shapeKey).toBe(shapes[1]?.shapeKey)
  })

  it('normalizes redundant predicate parentheses', async () => {
    const shapes = await extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id) WHERE (deleted_at IS NULL);
      CREATE INDEX idx_b ON sample (owner_id) WHERE ((deleted_at IS NULL));
    `)
    expect(shapes[0]?.shapeKey).toBe(shapes[1]?.shapeKey)
  })

  it('resolves implicit null ordering for ascending and descending indexes', async () => {
    const ascending = await extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id);
      CREATE INDEX idx_b ON sample (owner_id NULLS LAST);
    `)
    const descending = await extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id DESC);
      CREATE INDEX idx_b ON sample (owner_id DESC NULLS FIRST);
    `)
    expect(ascending[0]?.shapeKey).toBe(ascending[1]?.shapeKey)
    expect(descending[0]?.shapeKey).toBe(descending[1]?.shapeKey)
  })

  it('distinguishes ascending and descending indexes', async () => {
    const shapes = await extractIndexShapes(`
      CREATE INDEX idx_a ON sample (owner_id ASC);
      CREATE INDEX idx_b ON sample (owner_id DESC);
    `)
    expect(shapes[0]?.shapeKey).not.toBe(shapes[1]?.shapeKey)
  })

  it('accepts ONLY indexes without treating them as malformed SQL', async () => {
    const shapes = await extractIndexShapes('CREATE INDEX idx_only ON ONLY sample (owner_id);')
    expect(shapes).toHaveLength(1)
    expect(shapes[0]).toMatchObject({ idxname: 'idx_only', table: 'sample' })
  })

  it('preserves quoted identity and distinguishes INCLUDE and operator classes', async () => {
    const shapes = await extractIndexShapes(`
      CREATE INDEX idx_a ON "MixedCase" (owner_id);
      CREATE INDEX idx_b ON "mixedcase" (owner_id);
      CREATE INDEX idx_c ON "MixedCase" (owner_id) INCLUDE (other_id);
      CREATE INDEX idx_d ON "MixedCase" (owner_id uuid_ops);
    `)
    expect(new Set(shapes.map(({ shapeKey }) => shapeKey)).size).toBe(4)
    expect(shapes[0]?.table).toBe('MixedCase')
  })
})
