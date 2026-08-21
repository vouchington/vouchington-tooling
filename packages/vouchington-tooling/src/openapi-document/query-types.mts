export type OpenApiQueryParameter =
  | { kind: 'string'; format?: 'uuid' | 'uri'; description?: string }
  | { kind: 'uuid-or-uri'; description?: string }
  | { kind: 'boolean'; description?: string }
  | { kind: 'nullable-boolean'; description?: string }
  | { kind: 'number'; description?: string }
  | {
      kind: 'integer'
      minimum: number
      maximum: number
      default?: number
      description?: string
    }
  | { kind: 'enum'; values: readonly string[]; default?: string; description?: string }
  | {
      kind: 'csv-array'
      items: OpenApiQueryParameter
      style: 'form'
      explode: false
      description?: string
    }

export type OpenApiQueryContract = Readonly<Record<string, OpenApiQueryParameter>>
