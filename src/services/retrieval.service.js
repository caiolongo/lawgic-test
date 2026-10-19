import { chunkText } from '../domain/chunking.js';
import { selectChunks } from '../domain/similarity.js';

export async function retrieveContext(text, queries, { lia, rag }) {
  const chunks = chunkText(text, { size: rag.chunkSize, overlap: rag.chunkOverlap });
  if (chunks.length === 0 || queries.length === 0) return [];

  const vectors = await lia.embed([...chunks, ...queries.map((query) => query.text)]);
  const chunkVectors = vectors.slice(0, chunks.length);
  const queryVectors = vectors.slice(chunks.length).map((vector, i) => ({
    vector,
    topK: queries[i].topK ?? rag.defaultTopK,
  }));

  return selectChunks(chunkVectors, queryVectors).map(({ index, score }) => ({ index, text: chunks[index], score }));
}
