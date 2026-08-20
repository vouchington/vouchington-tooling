export function validateOptionalHttpOrigin(value: string, fieldName = 'origin'): void {
  if (!value) return

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw invalidOriginError(fieldName)
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    ![url.origin, `${url.origin}/`].includes(value)
  ) {
    throw invalidOriginError(fieldName)
  }
}

function invalidOriginError(fieldName: string): Error {
  return new Error(
    `${fieldName} must be empty or a pure HTTP(S) origin without credentials, path, query, or fragment`,
  )
}
