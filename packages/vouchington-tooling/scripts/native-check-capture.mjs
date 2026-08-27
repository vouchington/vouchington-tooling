const [limitText] = process.argv.slice(2)
const limit = Number(limitText)
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10 * 1024 * 1024) process.exit(2)
const buffer = Buffer.alloc(limit)
let offset = 0
let size = 0
for await (const chunk of process.stdin) {
  const data = Buffer.from(chunk)
  if (data.length >= limit) {
    data.copy(buffer, 0, data.length - limit)
    offset = 0
    size = limit
    continue
  }
  const tail = data.subarray(Math.max(0, data.length - limit))
  const first = Math.min(tail.length, limit - offset)
  tail.copy(buffer, offset, 0, first)
  if (first < tail.length) tail.copy(buffer, 0, first, tail.length)
  offset = (offset + tail.length) % limit
  size = Math.min(limit, size + data.length)
}
if (size < limit) {
  process.stdout.write(buffer.subarray(0, size))
} else {
  process.stdout.write(buffer.subarray(offset))
  process.stdout.write(buffer.subarray(0, offset))
}
