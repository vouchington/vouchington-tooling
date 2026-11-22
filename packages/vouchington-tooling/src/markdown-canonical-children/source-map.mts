export type SourceSegment = {
  end: number
  file: string
  firstLine: number
  start: number
}

export function sourceSegmentAtOffset(
  segments: readonly SourceSegment[],
  offset: number,
): SourceSegment {
  let start = 0
  let end = segments.length
  while (start < end) {
    const middle = Math.floor((start + end) / 2)
    const segment = segments[middle] as SourceSegment
    if (offset < segment.start) end = middle
    else if (offset >= segment.end) start = middle + 1
    else return segment
  }
  throw new Error(`No Markdown source segment for composed offset ${offset}`)
}
