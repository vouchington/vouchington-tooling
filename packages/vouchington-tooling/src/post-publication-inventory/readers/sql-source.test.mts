import { describe, expect, it } from 'vitest'
import { extractStaticSqlTemplateQuasis } from './sql-source.mts'
import type { ReaderSqlTemplateOptions } from './sql-template.mts'

const options: ReaderSqlTemplateOptions = {
  templateTag: 'queryText',
  appendMethod: 'extend',
  executorImports: new Map([['fixture-db', new Set(['fetchRows', 'execute'])]]),
  placeholderPrefix: 'slot_',
}
const extract = (source: string) => extractStaticSqlTemplateQuasis(source, options)

describe('reader SQL source fragments', () => {
  it('finds aliased configured executors and returns direct fragments before bindings', () => {
    expect(
      extract(`
        import { fetchRows as fetch, execute, ignored } from 'fixture-db';
        const local = queryText\`SELECT record_id FROM records\`;
        fetch(local);
        execute(queryText\`SELECT * FROM entries\`);
        fetch(\`SELECT * FROM extras\`);
        ignored(queryText\`SELECT * FROM ignored\`);
      `),
    ).toEqual(['SELECT * FROM entries', 'SELECT * FROM extras', 'SELECT record_id FROM records'])
  })

  it('preserves raw escapes and numbered interpolation placeholders', () => {
    expect(
      extract(
        String.raw`
        function load() { return queryText\`SELECT '\\n', \${value}, \${other} FROM records\`; }
      `
          .replaceAll('\\`', '`')
          .replaceAll('\\${', '${'),
      ),
    ).toEqual([String.raw`SELECT '\\n', slot_1, slot_2 FROM records`])
  })

  it('returns templates from functions and consumes exported variable bindings', () => {
    expect(
      extract(`
        export const statement = queryText\`SELECT * FROM records\`, number = 1;
        export const { other } = source;
        function first() { return \`SELECT * FROM plain\`; }
        function second() { return statement; }
        function third() { return unknown; }
        function fourth() { return 42; }
        function empty() { return; }
        const unused = queryText\`SELECT * FROM unused\`;
      `),
    ).toEqual(['SELECT * FROM plain', 'SELECT * FROM records'])
  })

  it('reassembles named append chains after declarations, including computed methods', () => {
    expect(
      extract(`
        statement.extend(queryText\`EARLY\`);
        export const statement = queryText\`SELECT * FROM records\`;
        statement.extend(queryText\` WHERE active\`);
        statement['extend'](\` ORDER BY record_id\`);
        statement.extend();
        statement.extend('NOT A TEMPLATE');
        statement.other(queryText\`IGNORED\`);
        unknown.extend(queryText\`UNKNOWN\`);
        getStatement().extend(queryText\`NOT A SIMPLE RECEIVER\`);
      `),
    ).toEqual(['SELECT * FROM records WHERE active ORDER BY record_id'])
  })

  it('ignores unrelated tags, calls, import sources and namespace or default executors', () => {
    expect(
      extract(`
        import other from 'fixture-db';
        import * as db from 'fixture-db';
        import { fetchRows as fake } from 'elsewhere';
        const { item } = source;
        const untouched = otherTag\`SELECT * FROM records\`;
        db.fetchRows(queryText\`SELECT * FROM namespace\`);
        fake(queryText\`SELECT * FROM wrong_source\`);
        other(queryText\`SELECT * FROM default_import\`);
        function load() { return otherTag\`SELECT * FROM wrong_tag\`; }
        call();
      `),
    ).toEqual([])
  })

  it('discovers conditional executor aliases in source order using either branch', () => {
    expect(
      extract(`
        import { fetchRows as fetch } from 'fixture-db';
        const first = flag ? fetch : unrelated;
        const second = flag ? unrelated : first;
        const missing = flag ? left : right;
        const unknown = flag ? getExecutor() : 1;
        const absent = flag ? undefined : null;
        let uninitialized;
        const { destructured } = flag ? fetch : fetch;
        first(queryText\`SELECT first\`);
        second(queryText\`SELECT second\`);
        missing(queryText\`SELECT ignored\`);
      `),
    ).toEqual(['SELECT first', 'SELECT second'])
  })

  it('preserves name-based heuristics rather than claiming scope or execution proof', () => {
    expect(
      extract(`
        import { fetchRows } from 'fixture-db';
        function shadowed(fetchRows) { fetchRows(queryText\`SELECT shadowed\`); }
        const delayed = queryText\`SELECT delayed\`;
        function expose() { return delayed; }
        delayed.extend(queryText\` AFTER RETURN\`);
      `),
    ).toEqual(['SELECT shadowed', 'SELECT delayed AFTER RETURN'])
  })

  it('treats parentheses transparently while excluding assertions and empty fragments', () => {
    expect(
      extract(`
        import { fetchRows } from 'fixture-db';
        export const empty = queryText\`\`;
        const statement = queryText\`SELECT record\`;
        fetchRows((statement));
        fetchRows(statement as unknown);
        fetchRows(...args);
        function load() { return (queryText\`SELECT parenthesized\`); }
        function none() { return queryText\`\`; }
      `),
    ).toEqual(['SELECT parenthesized', 'SELECT record'])
  })

  it('rejects syntax errors rather than trusting a recovered tree', () => {
    expect(() => extract('export const broken = queryText`unterminated')).toThrow(SyntaxError)
  })

  it('collects callback arguments before the chained call receiver', () => {
    expect(
      extract(`
        import { fetchRows } from 'fixture-db';
        fetchRows<string>(queryText\`SELECT initial\`).catch(() => {
          return fetchRows(queryText\`SELECT fallback\`);
        });
      `),
    ).toEqual(['SELECT fallback', 'SELECT initial'])
  })

  it('retains function-body and control-structure collection order', () => {
    expect(
      extract(`
        import { fetchRows } from 'fixture-db';
        function declared(parameter = fetchRows(queryText\`PARAM\`)) {
          fetchRows(queryText\`FUNCTION\`);
        }
        const expression = function(parameter = fetchRows(queryText\`PARAM\`)) {
          fetchRows(queryText\`EXPRESSION\`);
        };
        const arrow = (parameter = fetchRows(queryText\`PARAM\`)) => {
          fetchRows(queryText\`ARROW\`);
        };
        function signature(parameter: unknown): void;
        for (fetchRows(queryText\`INIT\`); fetchRows(queryText\`TEST\`); fetchRows(queryText\`UPDATE\`)) {
          fetchRows(queryText\`FOR\`);
        }
        for (;;) { fetchRows(queryText\`FOREVER\`); }
        while (fetchRows(queryText\`TEST\`)) { fetchRows(queryText\`WHILE\`); }
        for (const key in fetchRows(queryText\`SOURCE\`)) { fetchRows(queryText\`FOR IN\`); }
        for (const key of fetchRows(queryText\`SOURCE\`)) { fetchRows(queryText\`FOR OF\`); }
        try { fetchRows(queryText\`TRY\`); }
        catch (error) { fetchRows(queryText\`CATCH\`); }
        finally { fetchRows(queryText\`FINALLY\`); }
        try {} finally {}
        try {} catch {}
        switch (fetchRows(queryText\`SWITCH\`)) {
          case fetchRows(queryText\`CASE\`): fetchRows(queryText\`BODY\`);
          default: break;
        }
      `),
    ).toEqual([
      'FUNCTION',
      'PARAM',
      'EXPRESSION',
      'PARAM',
      'ARROW',
      'PARAM',
      'FOR',
      'INIT',
      'TEST',
      'UPDATE',
      'FOREVER',
      'WHILE',
      'TEST',
      'FOR IN',
      'SOURCE',
      'FOR OF',
      'SOURCE',
      'TRY',
      'FINALLY',
      'CATCH',
      'BODY',
      'CASE',
      'SWITCH',
    ])
  })

  it('visits class method and constructor bodies before default parameters', () => {
    expect(
      extract(`
        import { fetchRows } from 'fixture-db';
        class Repository {
          public constructor(p = fetchRows(queryText\`CTOR PARAM\`)) {
            fetchRows(queryText\`CTOR BODY\`);
          }
          @dec(fetchRows(queryText\`METHOD DECORATOR\`))
          [fetchRows(queryText\`METHOD NAME\`)](@dec(fetchRows(queryText\`PARAM DECORATOR\`)) p = fetchRows(queryText\`METHOD PARAM\`)) {
            fetchRows(queryText\`METHOD BODY\`);
          }
          @dec(fetchRows(queryText\`GET DECORATOR\`))
          get current() { return fetchRows(queryText\`GET BODY\`); }
          @dec(fetchRows(queryText\`SET DECORATOR\`))
          set current(value) { fetchRows(queryText\`SET BODY\`); }
        }
      `),
    ).toEqual([
      'CTOR BODY',
      'CTOR PARAM',
      'METHOD DECORATOR',
      'METHOD NAME',
      'METHOD BODY',
      'PARAM DECORATOR',
      'METHOD PARAM',
      'GET DECORATOR',
      'GET BODY',
      'SET DECORATOR',
      'SET BODY',
    ])
  })

  it('preserves alternate-before-consequent branch collection and source-position guards', () => {
    expect(
      extract(`
        export const statement = queryText\`SELECT base\`;
        if (flag) statement.extend(queryText\` THEN\`);
        else statement.extend(queryText\` ELSE\`);
        if (other) statement.extend(queryText\` NO ELSE\`);
        const choice = flag
          ? (() => { return queryText\`SELECT left\`; })()
          : (() => { return queryText\`SELECT right\`; })();
      `),
    ).toEqual(['SELECT right', 'SELECT left', 'SELECT base ELSE THEN NO ELSE'])
  })

  it('preserves raw escapes in simple templates and interpolated tails', () => {
    expect(extract('function load() { return queryText`SELECT \\n`; }')).toEqual(['SELECT \\n'])
    expect(extract('function load() { return queryText`SELECT ${value} \\n`; }')).toEqual([
      'SELECT slot_1 \\n',
    ])
  })

  it('preserves CRLF and CR source bytes instead of using normalized cooked text', () => {
    expect(extract('function load() { return queryText`SELECT\r\n id`; }')).toEqual([
      'SELECT\r\n id',
    ])
    expect(
      extract('function load() { return queryText`SELECT\r\n ${first}\r ${second}\r\n end`; }'),
    ).toEqual(['SELECT\r\n slot_1\r slot_2\r\n end'])
  })

  it('uses configured names and placeholders independently across calls', () => {
    const source = 'function load() { return sql`SELECT ${value}`; }'
    expect(extract(source)).toEqual([])
    expect(
      extractStaticSqlTemplateQuasis(source, {
        ...options,
        templateTag: 'sql',
        placeholderPrefix: 'parameter_',
      }),
    ).toEqual(['SELECT parameter_1'])
  })
})
