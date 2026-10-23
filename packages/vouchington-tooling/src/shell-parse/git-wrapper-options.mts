export type ExtraWrapper = { duration?: true; values: readonly string[] }

// Wrappers `readCommandPrefix` does not read through, with the options that take a separate value.
export const EXTRA_WRAPPERS: ReadonlyMap<string, ExtraWrapper> = new Map([
  ['doas', { values: ['-u', '-C'] }],
  [
    'ionice',
    {
      values: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata', '--pid', '--pgid', '--uid'],
    },
  ],
  ['nice', { values: ['-n', '--adjustment'] }],
  ['setsid', { values: [] }],
  ['stdbuf', { values: ['-i', '-o', '-e', '--input', '--output', '--error'] }],
  [
    'sudo',
    {
      values: [
        '-u',
        '-g',
        '-h',
        '-p',
        '-C',
        '-D',
        '-R',
        '-T',
        '-U',
        '-r',
        '-t',
        '--user',
        '--group',
        '--host',
        '--prompt',
        '--close-from',
        '--chdir',
        '--chroot',
        '--command-timeout',
        '--other-user',
        '--role',
        '--type',
      ],
    },
  ],
  ['timeout', { duration: true, values: ['-s', '-k', '--signal', '--kill-after'] }],
  [
    'xargs',
    {
      // `--replace`, `--eof` and `--max-lines` take their value only attached (`--eof=END`).
      values: [
        '-I',
        '-n',
        '-P',
        '-L',
        '-s',
        '-E',
        '-d',
        '-a',
        '--max-args',
        '--max-procs',
        '--max-chars',
        '--delimiter',
        '--arg-file',
      ],
    },
  ],
])
const DURATION = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[smhd]?$|^inf(?:inity)?[smhd]?$/i

/** The words after a wrapper's own options (and `timeout`'s duration). */
export function skipWrapper(words: string[], wrapper: ExtraWrapper): string[] {
  let cursor = 1
  while (words[cursor]?.startsWith('-') === true) {
    const word = words[cursor]!
    cursor += 1
    if (word === '--') break
    if (wrapper.values.includes(word)) cursor += 1
  }
  if (wrapper.duration === true && DURATION.test(words[cursor] ?? '')) cursor += 1
  return words.slice(cursor)
}
