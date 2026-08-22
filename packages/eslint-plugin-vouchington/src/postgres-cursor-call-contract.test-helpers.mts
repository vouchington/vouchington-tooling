import { ESLint } from 'eslint'
import plugin from './index.mts'

export const CURSOR_OPTIONS = {
  modules: ['@db/cursors', '@db/cursors/batches'],
  executors: ['runCursor', 'runCursorBatches'],
}

export async function lintCursor(
  code: string,
  filePath = 'src/service.js',
  options: Record<string, unknown> | null = CURSOR_OPTIONS,
  cwd = '/repo',
): Promise<ESLint.LintResult> {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*'],
        plugins: { vouchington: plugin as ESLint.Plugin },
        languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        rules: {
          'vouchington/postgres-cursor-call-contract':
            options === null ? 'error' : ['error', options],
        },
      },
    ],
  })
  const [result] = await eslint.lintText(code, { filePath })
  if (!result) throw new Error('expected lint result')
  return result
}

export function messageIds(result: ESLint.LintResult): string[] {
  return result.messages
    .map((message) => message.messageId)
    .filter((id): id is string => id != null)
}
