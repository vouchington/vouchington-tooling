export function groupBy<Row, Key>(rows: Row[], key: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>()
  for (const row of rows) {
    const groupKey = key(row)
    const group = groups.get(groupKey)
    if (group) group.push(row)
    else groups.set(groupKey, [row])
  }
  return groups
}

export function keyed<RecordValue>(
  entries: Iterable<[string, RecordValue]>,
): Record<string, RecordValue> {
  return Object.fromEntries([...entries].toSorted(([left], [right]) => left.localeCompare(right)))
}
