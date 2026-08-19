export function lineOfUtf8ByteOffset(content: string | Buffer, byteOffset: number): number {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  if (byteOffset > buffer.length) {
    throw new RangeError(
      `byteOffset ${byteOffset} is out of range for buffer length ${buffer.length}`,
    )
  }
  let line = 1
  for (let i = 0; i < byteOffset; i++) {
    if (buffer[i] === 10) line++
  }
  return line
}
