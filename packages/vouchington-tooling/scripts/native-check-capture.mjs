import { writeFile } from 'node:fs/promises'

const [output, limitText] = process.argv.slice(2)
const limit = Number.parseInt(limitText, 10)
if (!output || !Number.isSafeInteger(limit) || limit < 1) process.exit(2)
const chunks = []
let size = 0
for await (const chunk of process.stdin) {
  const data = Buffer.from(chunk)
  if (data.length >= limit) {
    chunks.length = 0
    chunks.push(data.subarray(data.length - limit))
    size = limit
    continue
  }
  chunks.push(data)
  size += data.length
  while (size > limit) size -= chunks.shift().length
}
await writeFile(output, Buffer.concat(chunks))
