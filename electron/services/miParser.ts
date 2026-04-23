export type MiValue = string | MiValue[] | { [key: string]: MiValue }

export interface MiRecord {
  raw: string
  token?: string
  recordType: 'result' | 'async' | 'stream'
  outputType: 'result' | 'console' | 'log' | 'target' | 'exec' | 'status' | 'notify'
  className: string
  payload: MiValue | { [key: string]: MiValue }
}

const recordTypeMapping = {
  '^': 'result',
  '~': 'stream',
  '&': 'stream',
  '@': 'stream',
  '*': 'async',
  '+': 'async',
  '=': 'async',
} as const

const outputTypeMapping = {
  '^': 'result',
  '~': 'console',
  '&': 'log',
  '@': 'target',
  '*': 'exec',
  '+': 'status',
  '=': 'notify',
} as const

function trim(value: string) {
  return value.trim()
}

function eatWhitespace(line: string, index: number) {
  let cursor = index

  while (cursor < line.length && /\s/.test(line[cursor])) {
    cursor += 1
  }

  return cursor
}

function nextVariableName(line: string, index: number): [number, string] {
  let cursor = index

  while (cursor < line.length && line[cursor] !== '=') {
    cursor += 1
  }

  return [cursor, trim(line.slice(index, cursor))]
}

function unescapeCString(value: string) {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
}

function nextConst(line: string, index: number): [number, string] {
  let cursor = index + 1

  while (cursor < line.length) {
    if (line[cursor] === '\\') {
      cursor += 2
      continue
    }

    if (line[cursor] === '"') {
      return [cursor + 1, unescapeCString(line.slice(index + 1, cursor))]
    }

    cursor += 1
  }

  return [cursor, unescapeCString(line.slice(index + 1))]
}

function nextValue(line: string, index: number): [number, MiValue] | null {
  if (line[index] === '"') {
    return nextConst(line, index)
  }

  if (line[index] === '{') {
    return nextTuple(line, index)
  }

  if (line[index] === '[') {
    return nextList(line, index)
  }

  return null
}

function nextResult(line: string, index: number): [number, string, MiValue] | null {
  const [nameEnd, name] = nextVariableName(line, index)
  const valueStart = eatWhitespace(line, nameEnd + 1)
  const value = nextValue(line, valueStart)

  if (!value) {
    return null
  }

  return [value[0], name, value[1]]
}

function nextTuple(line: string, index: number): [number, { [key: string]: MiValue }] {
  const result: { [key: string]: MiValue } = {}
  let cursor = index

  while (cursor < line.length && line[cursor] !== '}') {
    const parsed = nextResult(line, cursor + 1)

    if (!parsed) {
      break
    }

    result[parsed[1]] = parsed[2]
    cursor = eatWhitespace(line, parsed[0])
  }

  return [cursor + 1, result]
}

function nextList(line: string, index: number): [number, MiValue[]] {
  const result: MiValue[] = []
  let cursor = index

  while (cursor < line.length && line[cursor] !== ']') {
    cursor = eatWhitespace(line, cursor + 1)

    if (cursor >= line.length || line[cursor] === ']') {
      break
    }

    if (line[cursor] !== '"' && line[cursor] !== '{' && line[cursor] !== '[') {
      const [nameEnd] = nextVariableName(line, cursor)
      cursor = eatWhitespace(line, nameEnd + 1)
    }

    const value = nextValue(line, cursor)

    if (!value) {
      break
    }

    result.push(value[1])
    cursor = eatWhitespace(line, value[0])
  }

  return [cursor + 1, result]
}

function nextToken(line: string, index: number): [number, string] {
  let cursor = index

  while (cursor < line.length && /\d/.test(line[cursor])) {
    cursor += 1
  }

  return [cursor, line.slice(index, cursor)]
}

function nextClass(line: string, index: number): [number, string] {
  let cursor = index + 1

  while (cursor < line.length && line[cursor] !== ',') {
    cursor += 1
  }

  return [cursor, trim(line.slice(index + 1, cursor))]
}

function parseResults(line: string, index: number) {
  const result: { [key: string]: MiValue } = {}
  let cursor = index

  while (cursor < line.length) {
    if (line[cursor] === ',') {
      cursor += 1
    }

    cursor = eatWhitespace(line, cursor)

    if (cursor >= line.length) {
      break
    }

    const parsed = nextResult(line, cursor)

    if (!parsed) {
      break
    }

    result[parsed[1]] = parsed[2]
    cursor = eatWhitespace(line, parsed[0])
  }

  return result
}

export function parseGdbMiLine(rawLine: string): MiRecord | null {
  const line = rawLine.endsWith('\\n') ? rawLine.slice(0, -2) : rawLine.trim()

  if (!line || line === '(gdb)') {
    return null
  }

  const [tokenEnd, token] = nextToken(line, eatWhitespace(line, 0))
  const cursor = eatWhitespace(line, tokenEnd)
  const marker = line[cursor] as keyof typeof outputTypeMapping | undefined

  if (!marker || !(marker in outputTypeMapping)) {
    return null
  }

  if (marker === '~' || marker === '&' || marker === '@') {
    const [, text] = nextConst(line, cursor + 1)

    return {
      raw: rawLine,
      token: token || undefined,
      recordType: recordTypeMapping[marker],
      outputType: outputTypeMapping[marker],
      className: outputTypeMapping[marker],
      payload: text,
    }
  }

  const [classEnd, className] = nextClass(line, cursor)

  return {
    raw: rawLine,
    token: token || undefined,
    recordType: recordTypeMapping[marker],
    outputType: outputTypeMapping[marker],
    className,
    payload: parseResults(line, classEnd),
  }
}