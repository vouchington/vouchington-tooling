export function createFixtureDeadline() {
  const deadline = process.hrtime.bigint() + 4_000_000_000n
  return () => {
    const milliseconds = Number((deadline - process.hrtime.bigint()) / 1_000_000n)
    if (milliseconds <= 0) throw new Error('Analyzer fixture case deadline exhausted')
    return milliseconds
  }
}
