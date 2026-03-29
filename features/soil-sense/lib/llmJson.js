function extractFirstJsonObjectString(text) {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') inString = false
    } else {
      if (c === '"') inString = true
      else if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
  }
  return null
}

export function extractJson(text) {
  if (!text) return null
  let s = String(text).trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fence) s = fence[1].trim()

  const tryParse = (chunk) => {
    try {
      return JSON.parse(chunk)
    } catch {
      return null
    }
  }

  const direct = tryParse(s)
  if (direct) return direct

  const balanced = extractFirstJsonObjectString(s)
  if (balanced) {
    const parsed = tryParse(balanced)
    if (parsed) return parsed
  }

  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return tryParse(s.slice(start, end + 1))
}
