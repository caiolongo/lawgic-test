import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isEmptyValue, parseText, parseDate, parseSelect, parseFieldValue, isKnownFieldType, sanitizeAiOutput } from '../../src/domain/field-values.js';

const realFields = JSON.parse(readFileSync(new URL('../../data/fields.json', import.meta.url), 'utf8'));
const optionsOf = (key) => realFields.find((field) => field.key === key).options;

describe('isEmptyValue', () => {
  for (const value of ['INDEFINIDO', 'NÃO SE APLICA', 'N/A', '  INDEFINIDO ', '\tN/A\n']) {
    it(`considera vazio ${JSON.stringify(value)}`, () => {
      assert.equal(isEmptyValue(value), true);
    });
  }

  for (const value of ['', '   ', null, undefined]) {
    it(`considera vazio ${String(JSON.stringify(value))}`, () => {
      assert.equal(isEmptyValue(value), true);
    });
  }

  it('iguala as formas composta e decomposta de NÃO SE APLICA', () => {
    assert.equal(isEmptyValue('NÃO SE APLICA'), true);
  });

  for (const value of ['indefinido', 'Indefinido', 'NAO SE APLICA', 'não se aplica', 'n/a', 'NA']) {
    it(`não considera vazio ${JSON.stringify(value)}, que não está na lista do README`, () => {
      assert.equal(isEmptyValue(value), false);
    });
  }

  for (const value of ['Mariana Costa Ribeiro', 'INDEFINIDO, mas citado', 0, false, [], {}]) {
    it(`não considera vazio ${JSON.stringify(value)}`, () => {
      assert.equal(isEmptyValue(value), false);
    });
  }
});

describe('parseText', () => {
  it('remove espaços nas pontas (ruído real do mock)', () => {
    assert.equal(parseText('  Mariana Costa Ribeiro '), 'Mariana Costa Ribeiro');
  });

  it('remove tab e quebra de linha nas pontas', () => {
    assert.equal(parseText('\n\tBR-116 \n'), 'BR-116');
  });

  for (const value of ['R$ 15.000,00', 'km 245', 'Rua  das Flores', 'Exclusão imediata do NOME']) {
    it(`preserva o conteúdo interno de ${JSON.stringify(value)}`, () => {
      assert.equal(parseText(value), value);
    });
  }
});

describe('parseDate', () => {
  it('converte DD/MM/AAAA para AAAA-MM-DD (ruído real do mock)', () => {
    assert.equal(parseDate('12/03/2025'), '2025-03-12');
  });

  it('mantém AAAA-MM-DD', () => {
    assert.equal(parseDate('2025-01-22'), '2025-01-22');
  });

  it('aceita 29 de fevereiro em ano bissexto', () => {
    assert.equal(parseDate('29/02/2024'), '2024-02-29');
    assert.equal(parseDate('2024-02-29'), '2024-02-29');
  });

  for (const value of ['31/02/2025', '29/02/2023', '00/01/2025', '32/01/2025', '2025-13-01', '2025-00-10', '2025-04-31']) {
    it(`devolve null para a data impossível ${value}`, () => {
      assert.equal(parseDate(value), null);
    });
  }

  for (const value of ['5/3/2025', '2025-3-5', '12-03-2025', '12/03/25', '12 de março de 2025', '2025-03-12T10:00', '2025/03/12', ' 12/03/2025']) {
    it(`devolve null para o formato fora do README ${JSON.stringify(value)}`, () => {
      assert.equal(parseDate(value), null);
    });
  }
});

describe('parseSelect', () => {
  const realNoise = [
    ['TIPO_ACAO', 'INDENIZACAO POR DANOS MORAIS', 'DANOS_MORAIS'],
    ['NEGATIVACAO', 'SIM', 'S'],
    ['ORGAO_NEGATIVACAO', 'serasa experian', 'SERASA'],
    ['TIPO_OCORRENCIA', 'ACIDENTE DE TRANSITO', 'ACIDENTE'],
    ['TIPO_LESAO', 'LESAO GRAVE', 'GRAVE'],
  ];

  for (const [key, answer, expected] of realNoise) {
    it(`${key}: ${JSON.stringify(answer)} → ${expected} (ruído real do mock)`, () => {
      assert.equal(parseSelect(answer, optionsOf(key)), expected);
    });
  }

  for (const answer of ['NÃO', 'nao', 'N', 'Não', 'n']) {
    it(`${JSON.stringify(answer)} → N (exemplo do README)`, () => {
      assert.equal(parseSelect(answer, optionsOf('NEGATIVACAO')), 'N');
    });
  }

  it('aceita o value em qualquer caixa', () => {
    assert.equal(parseSelect('danos_morais', optionsOf('TIPO_ACAO')), 'DANOS_MORAIS');
    assert.equal(parseSelect('Serasa', optionsOf('ORGAO_NEGATIVACAO')), 'SERASA');
    assert.equal(parseSelect('Grave', optionsOf('TIPO_LESAO')), 'GRAVE');
  });

  const noGuess = [
    ['NEGATIVACAO', 'Sim, houve'],
    ['NEGATIVACAO', 'NÃO SE APLICA'],
    ['ORGAO_NEGATIVACAO', 'Experian'],
    ['ORGAO_NEGATIVACAO', 'Serasa Exp.'],
    ['TIPO_ACAO', 'Danos morais'],
    ['TIPO_LESAO', 'LESAO  GRAVE'],
    ['TIPO_LESAO', 'Lesão'],
  ];

  for (const [key, answer] of noGuess) {
    it(`${key}: ${JSON.stringify(answer)} → null (não chuta por semelhança)`, () => {
      assert.equal(parseSelect(answer, optionsOf(key)), null);
    });
  }

  it('dá prioridade ao value quando ele é igual ao label de outra opção', () => {
    const options = [
      { value: 'A', label: 'B' },
      { value: 'B', label: 'Outra' },
    ];
    assert.equal(parseSelect('B', options), 'B');
  });

  it('devolve null para campo sem options ou com lista vazia', () => {
    assert.equal(parseSelect('S', undefined), null);
    assert.equal(parseSelect('S', []), null);
  });
});

describe('parseFieldValue', () => {
  const text = { key: 'CAMPO_TEXTO', type: 'text' };
  const date = { key: 'CAMPO_DATA', type: 'date' };
  const select = { key: 'CAMPO_SELECT', type: 'select', options: [{ value: 'S', label: 'Sim' }, { value: 'N', label: 'Não' }] };

  it('despacha por type', () => {
    assert.equal(parseFieldValue(text, '  Mariana Costa Ribeiro '), 'Mariana Costa Ribeiro');
    assert.equal(parseFieldValue(date, '12/03/2025'), '2025-03-12');
    assert.equal(parseFieldValue(select, 'SIM'), 'S');
  });

  it('remove espaços nas pontas antes do parser (D-29)', () => {
    assert.equal(parseFieldValue(date, ' 22/01/2025'), '2025-01-22');
    assert.equal(parseFieldValue(select, ' SIM '), 'S');
    assert.equal(parseFieldValue(select, '\tnão\n'), 'N');
  });

  for (const field of [text, date, select]) {
    for (const raw of ['INDEFINIDO', 'NÃO SE APLICA', 'N/A', '', '  INDEFINIDO ', null, undefined]) {
      it(`${field.type}: ${String(JSON.stringify(raw))} → null`, () => {
        assert.equal(parseFieldValue(field, raw), null);
      });
    }
  }

  it('converte número e booleano em string (A6)', () => {
    assert.equal(parseFieldValue(text, 123), '123');
    assert.equal(parseFieldValue(text, 0), '0');
    assert.equal(parseFieldValue(text, true), 'true');
  });

  it('devolve null para objeto e array (A6)', () => {
    assert.equal(parseFieldValue(text, []), null);
    assert.equal(parseFieldValue(text, ['valor']), null);
    assert.equal(parseFieldValue(text, {}), null);
    assert.equal(parseFieldValue(select, { value: 'S' }), null);
  });

  it('trata type desconhecido como text (D-15)', () => {
    assert.equal(parseFieldValue({ key: 'CAMPO_CPF', type: 'cpf' }, ' 123.456.789-09 '), '123.456.789-09');
    assert.equal(parseFieldValue({ key: 'CAMPO_X', type: 'toString' }, ' valor '), 'valor');
  });
});

describe('isKnownFieldType', () => {
  for (const type of ['text', 'date', 'select']) {
    it(`reconhece ${type}`, () => assert.equal(isKnownFieldType(type), true));
  }

  for (const type of ['cpf', 'TEXT', 'toString', undefined]) {
    it(`não reconhece ${String(type)}`, () => assert.equal(isKnownFieldType(type), false));
  }
});

describe('sanitizeAiOutput', () => {
  const fields = [
    { key: 'CAMPO_TEXTO', type: 'text' },
    { key: 'CAMPO_DATA', type: 'date' },
    { key: 'CAMPO_SELECT', type: 'select', options: [{ value: 'S', label: 'Sim' }] },
    { key: 'constructor', type: 'text' },
  ];

  it('aplica o parser de cada campo e descarta chaves que não são campos (ruído real)', () => {
    const raw = {
      CAMPO_TEXTO: '  valor ',
      CAMPO_DATA: '12/03/2025',
      CAMPO_SELECT: 'SIM',
      OBSERVACOES: 'texto extra',
      COMARCA_ORIGEM: 'Campinas',
      '$where': 'x',
      'a.b': 'y',
    };

    assert.deepEqual(sanitizeAiOutput(fields, raw), {
      CAMPO_TEXTO: 'valor',
      CAMPO_DATA: '2025-03-12',
      CAMPO_SELECT: 'S',
      constructor: null,
    });
  });

  it('devolve null para campo que a IA não devolveu', () => {
    assert.deepEqual(sanitizeAiOutput(fields, { CAMPO_TEXTO: 'valor' }), {
      CAMPO_TEXTO: 'valor',
      CAMPO_DATA: null,
      CAMPO_SELECT: null,
      constructor: null,
    });
  });

  it('exige a key exata', () => {
    assert.equal(sanitizeAiOutput(fields, { campo_texto: 'valor' }).CAMPO_TEXTO, null);
  });

  it('devolve todos os campos null para resposta vazia', () => {
    const result = sanitizeAiOutput(fields, {});
    assert.deepEqual(Object.keys(result), fields.map((field) => field.key));
    assert.ok(Object.values(result).every((value) => value === null));
  });
});
