/** RFC 9110 sections 6.4.1 and 15.3.6 prohibit content at these response statuses. */
export function statusForbidsBody(status: number): boolean {
  return (status >= 100 && status < 200) || status === 204 || status === 205 || status === 304
}
