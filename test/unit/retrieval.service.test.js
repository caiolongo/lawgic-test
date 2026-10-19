import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { retrieveContext } from '../../src/services/retrieval.service.js';
import { BadGatewayError } from '../../src/errors/http-errors.js';

// Embedding falso: cada texto vira um vetor one-hot pela sua primeira letra.
// Chunks e frases que começam com a mesma letra têm cosseno 1; letras diferentes, 0.
const LETTERS = 'abcdefghij';
const oneHot = (input) => LETTERS.split('').map((letter) => (input[0] === letter ? 1 : 0));

function fakeLia(embedImpl = async (inputs) => inputs.map(oneHot)) {
  const calls = [];
  return {
    calls,
    embed: async (inputs) => {
      calls.push(inputs);
      return embedImpl(inputs);
    },
  };
}

const rag = { chunkSize: 4, chunkOverlap: 1, defaultTopK: 1 };
// Com size 4 / overlap 1, cada chunk começa 3 caracteres depois: "aaab", "bccd", "deef", "fggh".
const TEXT = 'aaabccdeefggh';
const CHUNKS = ['aaab', 'bccd', 'deef', 'fggh'];

describe('retrieveContext', () => {
  it('faz uma única chamada ao embed com [...chunks, ...frases]', async () => {
    const lia = fakeLia();
    await retrieveContext(TEXT, [{ text: 'b frase' }, { text: 'f frase' }], { lia, rag });
    assert.deepEqual(lia.calls, [[...CHUNKS, 'b frase', 'f frase']]);
  });

  it('devolve { index, text, score } com o texto exato do chunk, em ordem do documento', async () => {
    const result = await retrieveContext(TEXT, [{ text: 'f frase' }, { text: 'a frase' }], { lia: fakeLia(), rag });
    assert.deepEqual(result, [
      { index: 0, text: 'aaab', score: 1 },
      { index: 3, text: 'fggh', score: 1 },
    ]);
  });

  it('respeita o topK da frase e usa defaultTopK quando ela não tem', async () => {
    const lia = fakeLia();
    const withTopK = await retrieveContext(TEXT, [{ text: 'b frase', topK: 3 }], { lia, rag });
    assert.equal(withTopK.length, 3);
    const withDefault = await retrieveContext(TEXT, [{ text: 'b frase' }], { lia, rag: { ...rag, defaultTopK: 2 } });
    assert.equal(withDefault.length, 2);
  });

  it('frases que escolhem o mesmo chunk → ele entra uma vez', async () => {
    const result = await retrieveContext(TEXT, [{ text: 'd um' }, { text: 'd dois' }], { lia: fakeLia(), rag });
    assert.deepEqual(result.map(({ index }) => index), [2]);
  });

  it('sem frases → [] sem chamar o embed', async () => {
    const lia = fakeLia();
    assert.deepEqual(await retrieveContext(TEXT, [], { lia, rag }), []);
    assert.equal(lia.calls.length, 0);
  });

  it('texto vazio → [] sem chamar o embed', async () => {
    const lia = fakeLia();
    assert.deepEqual(await retrieveContext('', [{ text: 'a frase' }], { lia, rag }), []);
    assert.equal(lia.calls.length, 0);
  });

  it('o BadGatewayError do embed sobe intacto', async () => {
    const failure = new BadGatewayError('Falha na chamada à IA', { code: 'LIA_UNAVAILABLE' });
    const lia = fakeLia(async () => {
      throw failure;
    });
    await assert.rejects(retrieveContext(TEXT, [{ text: 'a frase' }], { lia, rag }), (error) => error === failure);
  });
});
