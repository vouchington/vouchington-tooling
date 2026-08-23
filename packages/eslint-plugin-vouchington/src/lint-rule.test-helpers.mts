import { ESLint } from 'eslint'
import plugin from './index.mts'

export async function lintRule(
  rule: string,
  code: string,
  options: Record<string, unknown> | null,
  filePath = 'src/service.js',
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
          [`vouchington/${rule}`]: options === null ? 'error' : ['error', options],
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
