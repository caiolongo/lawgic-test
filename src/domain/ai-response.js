export function extractJson(text) {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = findObjectEnd(text, start);
    if (end === -1) continue;

    const parsed = tryParse(text.slice(start, end + 1));
    if (isPlainObject(parsed)) return parsed;
  }
  return null;
}

function findObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return i;
  }
  return -1;
}

function tryParse(candidate) {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
