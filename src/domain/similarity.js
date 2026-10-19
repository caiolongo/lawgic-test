export function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    throw new RangeError(`Vetores com tamanhos diferentes: ${a.length} e ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function selectChunks(chunkVectors, queries) {
  const selected = new Map();
  for (const { vector, topK } of queries) {
    const ranked = chunkVectors
      .map((chunkVector, index) => ({ index, score: cosineSimilarity(vector, chunkVector) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, topK);
    for (const { index, score } of ranked) {
      selected.set(index, Math.max(selected.get(index) ?? -Infinity, score));
    }
  }
  return [...selected].map(([index, score]) => ({ index, score })).sort((a, b) => a.index - b.index);
}
