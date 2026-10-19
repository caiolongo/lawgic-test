import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectMongo, closeMongo } from '../../src/integrations/mongo/client.js';
import { findCompanyByKey } from '../../src/integrations/mongo/companies.repository.js';
import { findFieldsByCompany } from '../../src/integrations/mongo/fields.repository.js';
import { findQueriesByCompany } from '../../src/integrations/mongo/queries.repository.js';
import { insertExtraction, findExtractionById } from '../../src/integrations/mongo/extractions.repository.js';

const TEST_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/mini-lia-test-repositories';

let db;

before(async () => {
  db = await connectMongo(TEST_URI);
  await db.dropDatabase();
});

after(async () => {
  await db.dropDatabase();
  await closeMongo();
});

describe('findCompanyByKey', () => {
  before(() => db.collection('companies').insertOne({ key: 'empresa-x', name: 'Empresa X' }));

  it('devolve a empresa sem _id', async () => {
    assert.deepEqual(await findCompanyByKey('empresa-x'), { key: 'empresa-x', name: 'Empresa X' });
  });

  it('devolve null para empresa inexistente', async () => {
    assert.equal(await findCompanyByKey('empresa-z'), null);
  });

  it('compara a chave exatamente (F5)', async () => {
    assert.equal(await findCompanyByKey('EMPRESA-X'), null);
    assert.equal(await findCompanyByKey(' empresa-x'), null);
  });
});

describe('findFieldsByCompany', () => {
  const field = (overrides) => ({ companyKey: 'empresa-x', order: 1, key: 'CAMPO_A', label: 'Campo', type: 'text', required: false, ...overrides });
  const select = field({ order: 1, key: 'CAMPO_S', type: 'select', options: [{ value: 'S', label: 'Sim' }] });
  const attached = field({ order: 2, key: 'CAMPO_B', attached: [{ key: 'CAMPO_S', values: ['S'] }] });
  const tieA = field({ order: 3, key: 'CAMPO_A' });
  const tieC = field({ order: 3, key: 'CAMPO_C' });

  before(() =>
    db.collection('fields').insertMany([
      { ...tieC },
      { ...attached },
      field({ companyKey: 'empresa-y', key: 'CAMPO_Y' }),
      { ...tieA },
      { ...select },
    ]),
  );

  it('ordena por order e desempata por key', async () => {
    assert.deepEqual(
      (await findFieldsByCompany('empresa-x')).map((f) => f.key),
      ['CAMPO_S', 'CAMPO_B', 'CAMPO_A', 'CAMPO_C'],
    );
  });

  it('devolve os documentos no formato original, sem _id', async () => {
    assert.deepEqual(await findFieldsByCompany('empresa-x'), [select, attached, tieA, tieC]);
  });

  it('devolve só os campos da empresa pedida', async () => {
    assert.deepEqual((await findFieldsByCompany('empresa-y')).map((f) => f.key), ['CAMPO_Y']);
  });

  it('devolve lista vazia para empresa sem campos', async () => {
    assert.deepEqual(await findFieldsByCompany('empresa-z'), []);
  });
});

describe('findQueriesByCompany', () => {
  before(() =>
    db.collection('queries').insertMany([
      { companyKey: 'empresa-x', position: 2, text: 'terceira' },
      { companyKey: 'empresa-x', position: 0, text: 'primeira', topK: 3 },
      { companyKey: 'empresa-y', position: 0, text: 'de outra empresa' },
      { companyKey: 'empresa-x', position: 1, text: 'segunda' },
    ]),
  );

  it('ordena por position e traz só text e topK (ausente continua ausente)', async () => {
    assert.deepEqual(await findQueriesByCompany('empresa-x'), [
      { text: 'primeira', topK: 3 },
      { text: 'segunda' },
      { text: 'terceira' },
    ]);
  });

  it('devolve só as frases da empresa pedida', async () => {
    assert.deepEqual(await findQueriesByCompany('empresa-y'), [{ text: 'de outra empresa' }]);
  });

  it('empresa sem frases → []', async () => {
    assert.deepEqual(await findQueriesByCompany('empresa-z'), []);
  });
});

describe('insertExtraction / findExtractionById', () => {
  const doc = () => ({
    companyKey: 'empresa-x',
    strategy: 'fullContent',
    usedChunks: 0,
    formData: { CAMPO_A: 'valor', CAMPO_B: null },
    missingRequired: ['CAMPO_B'],
    file: { name: 'processo.pdf', size: 123, pages: 2 },
    createdAt: new Date('2025-01-02T03:04:05.000Z'),
  });

  it('grava e devolve o documento com _id, sem alterar o objeto recebido', async () => {
    const input = doc();
    const saved = await insertExtraction(input);
    assert.deepEqual(input, doc());
    assert.ok(saved._id);
    assert.deepEqual({ ...saved, _id: undefined }, { ...doc(), _id: undefined });
    assert.deepEqual(await findExtractionById(saved._id.toString()), saved);
  });

  it('ObjectId válido inexistente → null', async () => {
    assert.equal(await findExtractionById('0123456789abcdef01234567'), null);
  });

  for (const id of ['abc', '', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz']) {
    it(`id mal formado ${JSON.stringify(id)} → null, sem erro`, async () => {
      assert.equal(await findExtractionById(id), null);
    });
  }
});
