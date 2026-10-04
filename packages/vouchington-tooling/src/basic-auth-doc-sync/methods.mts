const HTTP_METHOD_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Z]+$/
export function isCanonicalHttpMethod(method: string): boolean {
  return method === method.toUpperCase() && HTTP_METHOD_TOKEN_RE.test(method)
}
