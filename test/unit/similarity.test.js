import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, selectChunks } from '../../src/domain/similarity.js';

const assertClose = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} ≠ ${expected}`);

describe('cosineSimilarity', () => {
  it('mesma direção → 1 (exemplo do Cosine-similarity.pdf)', () => {
    assertClose(cosineSimilarity([1, 2, 3], [2, 4, 6]), 1);
  });

  it('ortogonais → 0', () => {
    assertClose(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  it('opostos → -1', () => {
    assertClose(cosineSimilarity([1, 2, 3], [-1, -2, -3]), -1);
  });

  it('ângulo de 45° → √2/2', () => {
    assertClose(cosineSimilarity([1, 0], [1, 1]), Math.SQRT1_2);
  });

  it('não depende da magnitude', () => {
    const a = [0.3, -1.2, 4];
    const b = [2, 0.5, -0.7];
    assertClose(cosineSimilarity(a, b.map((x) => x * 1000)), cosineSimilarity(a, b));
  });

  for (const [name, a, b] of [
    ['primeiro vetor zero', [0, 0, 0], [1, 2, 3]],
    ['segundo vetor zero', [1, 2, 3], [0, 0, 0]],
    ['os dois zero', [0, 0], [0, 0]],
  ]) {
    it(`${name} → 0, não NaN`, () => {
      assert.equal(cosineSimilarity(a, b), 0);
    });
  }

  it('tamanhos diferentes → RangeError', () => {
    assert.throws(() => cosineSimilarity([1, 2], [1, 2, 3]), RangeError);
  });
});

describe('selectChunks', () => {
  // Vetores unitários em ângulos conhecidos: o cosseno com [1, 0] é cos(θ).
  const at = (degrees) => [Math.cos((degrees * Math.PI) / 180), Math.sin((degrees * Math.PI) / 180)];
  const chunks = [at(80), at(10), at(60), at(30), at(170)];
  const indexes = (selection) => selection.map(({ index }) => index);

  it('topK chunks de maior cosseno da frase, em ordem do documento', () => {
    const selection = selectChunks(chunks, [{ vector: at(0), topK: 2 }]);
    assert.deepEqual(indexes(selection), [1, 3]);
    assertClose(selection[0].score, Math.cos((10 * Math.PI) / 180));
  });

  it('chunk escolhido por duas frases entra uma vez, com a maior nota, sem completar com outro', () => {
    const selection = selectChunks(chunks, [
      { vector: at(0), topK: 1 },
      { vector: at(20), topK: 1 },
    ]);
    assert.deepEqual(indexes(selection), [1]);
    assertClose(selection[0].score, Math.cos((10 * Math.PI) / 180));
  });

  it('a nota do chunk repetido é a maior entre as frases', () => {
    const selection = selectChunks(chunks, [
      { vector: at(40), topK: 1 },
      { vector: at(30), topK: 1 },
    ]);
    assert.deepEqual(indexes(selection), [3]);
    assertClose(selection[0].score, 1);
  });

  it('respeita o topK de cada frase', () => {
    const selection = selectChunks(chunks, [
      { vector: at(0), topK: 1 },
      { vector: at(180), topK: 2 },
    ]);
    assert.deepEqual(indexes(selection), [0, 1, 4]);
  });

  it('topK maior que o número de chunks → todos', () => {
    assert.deepEqual(indexes(selectChunks(chunks, [{ vector: at(0), topK: 99 }])), [0, 1, 2, 3, 4]);
  });

  it('empate → o chunk que aparece antes no documento', () => {
    const tied = [at(30), at(-30), at(30)];
    assert.deepEqual(indexes(selectChunks(tied, [{ vector: at(0), topK: 1 }])), [0]);
    assert.deepEqual(indexes(selectChunks([at(50), ...tied], [{ vector: at(0), topK: 2 }])), [1, 2]);
  });

  it('sem frases ou sem chunks → []', () => {
    assert.deepEqual(selectChunks(chunks, []), []);
    assert.deepEqual(selectChunks([], [{ vector: at(0), topK: 2 }]), []);
  });

  it('chunk com vetor zero recebe nota 0 e não quebra a ordenação', () => {
    const selection = selectChunks([[0, 0], at(100), at(10)], [{ vector: at(0), topK: 2 }]);
    assert.deepEqual(indexes(selection), [0, 2]);
    assert.equal(selection[0].score, 0);
  });
});
