export interface ApiCommit {
  commit?: { tree?: { sha?: string } }
  sha?: string
}
export interface ApiTreeEntry {
  mode?: string
  path?: string
  sha?: string
  type?: string
}
export interface ApiTree {
  truncated?: boolean
  tree?: ApiTreeEntry[]
}
export interface ApiBlob {
  content?: string
  encoding?: string
}
