export function chunkText(text, { size, overlap }) {
  if (overlap >= size) {
    throw new RangeError(`overlap (${overlap}) deve ser menor que size (${size})`);
  }

  const chunks = [];
  for (let start = 0; start < text.length; start += size - overlap) {
    chunks.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return chunks;
}
