/** All repository-specific names are explicit; SQL recognition preserves the inventory heuristic. */
export interface PostPublicationWriterSourceOptions {
  captureModules: ReadonlySet<string>
  captureSymbols: ReadonlySet<string>
  eligibilityTables: ReadonlySet<string>
  captureOption: string
  insertBuilder: string
  identifierAssertion: string
  entityTable: { receiver: string; property: string }
  relationTable: { receiver: string; property: string }
  relationElectionAllowlist: string
  appendMethod: string
}
