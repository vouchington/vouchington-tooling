export type SettlementConfirmation<Configuration> = {
  configuration: Configuration
  settled: boolean
}

export type SettlementCallbacks<Configuration, Value> = {
  buildAttempt(configuration: Configuration): Value
  confirmAttempt(configuration: Configuration, value: Value): SettlementConfirmation<Configuration>
}

/** Rebuilds against the configuration returned by each failed confirmation. */
export function settleBuild<Configuration, Value>(
  initialConfiguration: Configuration,
  maximumAttempts: number,
  callbacks: SettlementCallbacks<Configuration, Value>,
): Value {
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1)
    throw new RangeError('maximumAttempts must be a positive safe integer')
  let configuration = initialConfiguration
  for (let attempts = 1; attempts <= maximumAttempts; attempts += 1) {
    const value = callbacks.buildAttempt(configuration)
    const confirmation = callbacks.confirmAttempt(configuration, value)
    if (confirmation.settled) return value
    configuration = confirmation.configuration
  }
  throw new Error(`Inputs changed during ${maximumAttempts} consecutive build attempts`)
}
