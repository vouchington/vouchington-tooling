import type { RegisteredRoute } from './registered-route-catalog.mts'

export type Carrier = 'path' | 'query' | 'body' | 'header'

export const CARRIERS: readonly Carrier[] = ['path', 'query', 'body', 'header']

export type ValidatorConfig = {
  /** Resolved declaration file path suffix, or a package specifier, of the export. */
  module: string
  exportName: string
  operationArgument: number
  carriers:
    | { kind: 'input-object'; argument: number }
    | {
        kind: 'fixed'
        carriers: readonly Carrier[]
        optionCarriers?: readonly { argument: number; property: string; carrier: Carrier }[]
      }
}

export type FactoryConfig = {
  module: string
  exportName: string
  optionsArgument: number
  operationProperty: string
  carriers: readonly Carrier[]
}

/** A validated carrier and the request carriers its value derives from. */
export type ValidatorSiteCarrier = {
  carrier: Carrier
  origins: Carrier[]
  /** Set when part of the value cannot be traced, such as an unbound parameter. */
  unresolved?: string
}

export type ExecutedCallbackConfig = {
  module: string
  exportName: string
  /** Index of the object-literal argument. */
  argument: number
  /** Function-valued properties of that object treated as executed. */
  properties: readonly string[]
}

export type ValidatorSite = {
  exportName: string
  source: string
  operation: string | null
  unresolvedReason?: string
  carriers: ValidatorSiteCarrier[]
  /**
   * Set when the input object cannot be fully resolved (a non-literal input, an unresolvable
   * spread or a computed property name), so `carriers` may be incomplete.
   */
  unresolvedCarriers?: string
  conditional: boolean
}

export type FactorySite = {
  exportName: string
  source: string
  operation: string | null
  unresolvedReason?: string
  carriers: Carrier[]
}

/**
 * `key` for a static key, `computed` for a non-static key (`key: null`), `whole` for the carrier
 * used as a value or a body read (`key: null`).
 */
type CarrierReadAccess = 'key' | 'computed' | 'whole'

export type CarrierRead = {
  carrier: Carrier
  key: string | null
  access: CarrierReadAccess
  source: string
}

export type RouteValidationFacts = {
  kind: RegisteredRoute['kind']
  source: string
  validatorSites: ValidatorSite[]
  factorySites: FactorySite[]
  carrierReads: CarrierRead[]
}
