import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForCompare } from '../../src/domain/text-normalize.js';

describe('normalizeForCompare', () => {
  it('iguala as variações de caixa e acento do exemplo do README', () => {
    assert.equal(normalizeForCompare('NÃO'), 'nao');
    assert.equal(normalizeForCompare('nao'), 'nao');
    assert.equal(normalizeForCompare('Não'), 'nao');
  });

  it('remove acentos e cedilha', () => {
    assert.equal(normalizeForCompare('INDENIZAÇÃO POR DANOS MORAIS'), 'indenizacao por danos morais');
    assert.equal(normalizeForCompare('Lesão Grave'), 'lesao grave');
    assert.equal(normalizeForCompare('Trânsito'), 'transito');
  });

  it('trata igual o caractere acentuado composto e o decomposto', () => {
    assert.equal(normalizeForCompare('NÃO'), normalizeForCompare('NÃO'));
  });

  it('não altera espaços nem pontuação', () => {
    assert.equal(normalizeForCompare(' SIM'), ' sim');
    assert.equal(normalizeForCompare('LESAO  GRAVE'), 'lesao  grave');
    assert.equal(normalizeForCompare('Sim, houve'), 'sim, houve');
    assert.equal(normalizeForCompare('N/A'), 'n/a');
  });

  it('mantém string vazia', () => {
    assert.equal(normalizeForCompare(''), '');
  });
});
