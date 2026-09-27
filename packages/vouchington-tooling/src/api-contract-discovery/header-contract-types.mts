export type HeaderContract = {
  requestHeaders: Readonly<Record<string, HeaderDescriptor>>
  responseHeaders: Readonly<Record<number, ResponseHeaderDescriptor>>
}

export type HeaderDescriptor = {
  description?: string
  format?: 'uuid'
  required: boolean
  type: 'integer' | 'string'
}

export type ResponseHeaderDescriptor = {
  description?: string
  errors?: readonly { code: string; message: string }[]
  headers: Readonly<Record<string, HeaderDescriptor>>
}

export type HeaderContractRegistry = Readonly<Record<string, HeaderContract>>
