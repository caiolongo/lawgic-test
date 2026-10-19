import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../../src/domain/ai-response.js';

describe('extractJson', () => {
  it('extrai o JSON de dentro de ```json com prosa antes e depois', () => {
    const text = 'Segue a extração:\n```json\n{ "CAMPO_A": "valor", "CAMPO_B": "INDEFINIDO" }\n```\nQualquer dúvida, avise.';
    assert.deepEqual(extractJson(text), { CAMPO_A: 'valor', CAMPO_B: 'INDEFINIDO' });
  });

  it('extrai o JSON no meio de texto, sem cerca', () => {
    assert.deepEqual(extractJson('Resultado: {"CAMPO_A": "valor"} fim.'), { CAMPO_A: 'valor' });
  });

  it('ignora chaves soltas na prosa antes do JSON', () => {
    assert.deepEqual(extractJson('Use {chave}: valor. { incompleto\n{"CAMPO_A": "x"}'), { CAMPO_A: 'x' });
  });

  it('ignora chaves e aspas escapadas dentro de strings', () => {
    const text = 'ok {"CAMPO_A": "texto {com} chaves", "CAMPO_B": "aspas \\"}\\" escapadas"} fim';
    assert.deepEqual(extractJson(text), { CAMPO_A: 'texto {com} chaves', CAMPO_B: 'aspas "}" escapadas' });
  });

  it('fecha o objeto só na chave mais externa', () => {
    assert.deepEqual(extractJson('{"CAMPO_A": {"interno": 1}, "CAMPO_B": "x"}'), { CAMPO_A: { interno: 1 }, CAMPO_B: 'x' });
  });

  it('aceita objeto vazio', () => {
    assert.deepEqual(extractJson('```json\n{}\n```'), {});
  });

  it('devolve o primeiro objeto válido quando há mais de um', () => {
    assert.deepEqual(extractJson('{"a": 1} e depois {"b": 2}'), { a: 1 });
  });

  const invalid = [
    ['texto sem JSON', 'Não encontrei os campos.'],
    ['JSON quebrado', '```json\n{ "CAMPO_A": "valor", }\n```'],
    ['objeto sem fechar', '{"CAMPO_A": "valor"'],
    ['só um array', '```json\n["valor"]\n```'],
    ['texto vazio', ''],
  ];

  for (const [name, text] of invalid) {
    it(`devolve null para ${name}`, () => {
      assert.equal(extractJson(text), null);
    });
  }
});
