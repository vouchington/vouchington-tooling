import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('loads the runbook reader when the optional compiler cannot resolve', () => {
  const moduleUrl = new URL('./runbook.mts', import.meta.url).href
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === '@typescript/typescript6') throw new Error('Optional compiler unavailable');
      return nextResolve(specifier, context);
    }});
    const { findRunbookExemptRoutes } = await import(${JSON.stringify(moduleUrl)});
    if (findRunbookExemptRoutes('### Routes', 'Routes') !== null) throw new Error('Expected no table');
    console.log('Compiler-free reader loaded');
  `
  expect(
    execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    }).trim(),
  ).toBe('Compiler-free reader loaded')
})
