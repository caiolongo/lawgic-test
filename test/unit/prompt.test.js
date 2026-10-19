import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildPrompt, promptLength, fitToBudget } from '../../src/domain/prompt.js';

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const allFields = await readJson('../../data/fields.json');
const companies = await readJson('../../data/companies.json');
const { knownKeys } = await readJson('../../lia-mock/evidence/public.json');

// Mesma detecção do mock (lia-mock/src/chat.js): key como palavra inteira em system + messages.
const requestedKeys = ({ system, messages }) => {
  const prompt = [system, ...messages.map((message) => message.content)].join('\n\n');
  return knownKeys.filter((key) => new RegExp(`(?<![A-Za-z0-9_])${key}(?![A-Za-z0-9_])`).test(prompt));
};

const userContent = (prompt) => prompt.messages[0].content;

describe('buildPrompt', () => {
  for (const { key: companyKey } of companies) {
    it(`${companyKey}: o mock detecta exatamente as keys da empresa`, () => {
      const fields = allFields.filter((field) => field.companyKey === companyKey);
      const prompt = buildPrompt(fields, ['texto do documento']);
      assert.deepEqual(requestedKeys(prompt).sort(), fields.map((field) => field.key).sort());
    });
  }

  it('devolve system e uma mensagem de usuário', () => {
    const prompt = buildPrompt([], ['x']);
    assert.equal(typeof prompt.system, 'string');
    assert.equal(prompt.messages.length, 1);
    assert.equal(prompt.messages[0].role, 'user');
  });

  it('cada campo aparece com key, tipo e label, na ordem recebida', () => {
    const fields = [
      { key: 'CAMPO_B', type: 'text', label: 'Campo B' },
      { key: 'CAMPO_A', type: 'date', label: 'Campo A' },
    ];
    const content = userContent(buildPrompt(fields, ['x']));
    assert.ok(content.startsWith('Campos:\n- CAMPO_B (text): Campo B\n- CAMPO_A (date): Campo A\n'));
  });

  it('select lista value (label) de todas as opções', () => {
    const fields = [
      {
        key: 'OPCAO',
        type: 'select',
        label: 'Opção',
        options: [
          { value: 'S', label: 'Sim' },
          { value: 'N', label: 'Não' },
        ],
      },
    ];
    assert.ok(userContent(buildPrompt(fields, ['x'])).includes('- OPCAO (select): Opção — opções: S (Sim), N (Não)'));
  });

  it('campo de tipo desconhecido e sem opções → linha simples', () => {
    const fields = [{ key: 'CAMPO', type: 'cpf', label: 'CPF', options: [] }];
    assert.ok(userContent(buildPrompt(fields, ['x'])).includes('- CAMPO (cpf): CPF\n'));
  });

  it('trechos vão verbatim, na ordem, separados por ---', () => {
    const excerpts = ['AÇÃO\nDE  INDENIZAÇÃO', 'R$\n4.870,00 '];
    const content = userContent(buildPrompt([], excerpts));
    assert.ok(content.endsWith('Trechos do documento:\n---\nAÇÃO\nDE  INDENIZAÇÃO\n---\nR$\n4.870,00 \n---'));
  });

  it('sem trechos → (nenhum trecho)', () => {
    assert.ok(userContent(buildPrompt([], [])).endsWith('Trechos do documento:\n(nenhum trecho)'));
  });
});

describe('promptLength', () => {
  it('é o tamanho da string que o mock monta: system e conteúdos unidos por \\n\\n', () => {
    const prompt = { system: 'abc', messages: [{ role: 'user', content: 'de' }, { role: 'user', content: 'f' }] };
    assert.equal(promptLength(prompt), 'abc\n\nde\n\nf'.length);
    assert.equal(promptLength({ messages: [{ role: 'user', content: 'de' }] }), '\n\nde'.length);
  });
});

describe('fitToBudget', () => {
  const fields = [{ key: 'CAMPO', type: 'text', label: 'Campo' }];
  const chunk = (index, score, size = 100) => ({ index, score, text: String(index).repeat(size) });
  const lengthWith = (kept) => promptLength(buildPrompt(fields, kept.map(({ text }) => text)));
  const indexes = (result) => result.chunks.map(({ index }) => index);

  const chunks = [chunk(0, 0.5), chunk(1, 0.2), chunk(2, 0.9), chunk(3, 0.4)];

  it('tudo cabe → todos os trechos, prompt igual ao buildPrompt', () => {
    const result = fitToBudget(fields, chunks, lengthWith(chunks));
    assert.deepEqual(indexes(result), [0, 1, 2, 3]);
    assert.deepEqual(result.prompt, buildPrompt(fields, chunks.map(({ text }) => text)));
  });

  it('estouro → corta o de menor nota primeiro, depois o seguinte', () => {
    const withoutLowest = [chunks[0], chunks[2], chunks[3]];
    assert.deepEqual(indexes(fitToBudget(fields, chunks, lengthWith(withoutLowest))), [0, 2, 3]);
    assert.deepEqual(indexes(fitToBudget(fields, chunks, lengthWith(withoutLowest) - 1)), [0, 2]);
  });

  it('o resultado cabe e é máximo: devolver o último cortado estouraria', () => {
    for (let maxChars = lengthWith([]); maxChars <= lengthWith(chunks); maxChars += 7) {
      const result = fitToBudget(fields, chunks, maxChars);
      assert.ok(promptLength(result.prompt) <= maxChars);
      const cut = chunks.filter((c) => !result.chunks.includes(c)).sort((a, b) => b.score - a.score)[0];
      if (cut) {
        const restored = chunks.filter((c) => result.chunks.includes(c) || c === cut);
        assert.ok(lengthWith(restored) > maxChars);
      }
    }
  });

  it('empate de nota → sai primeiro o que aparece mais adiante; saída em ordem do documento', () => {
    const tied = [chunk(0, 0.3), chunk(1, 0.3), chunk(2, 0.8)];
    const result = fitToBudget(fields, tied, lengthWith([tied[0], tied[2]]));
    assert.deepEqual(indexes(result), [0, 2]);
  });

  it('nada cabe → chunks [] e prompt com (nenhum trecho)', () => {
    const result = fitToBudget(fields, chunks, 10);
    assert.deepEqual(result.chunks, []);
    assert.ok(result.prompt.messages[0].content.endsWith('(nenhum trecho)'));
  });
});
