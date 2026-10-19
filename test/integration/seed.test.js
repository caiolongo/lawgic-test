import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectMongo, closeMongo } from '../../src/integrations/mongo/client.js';
import { ensureIndexes } from '../../src/integrations/mongo/indexes.js';
import { seedCompanies, seedFields, seedQueries } from '../../scripts/seed.js';

const TEST_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/mini-lia-test-seed';

let db;

before(async () => {
  db = await connectMongo(TEST_URI);
  await db.dropDatabase();
  await ensureIndexes(db);
});

after(async () => {
  await db.dropDatabase();
  await closeMongo();
});

const findAll = (collection, sort) =>
  db.collection(collection).find({}, { projection: { _id: 0 } }).sort(sort).toArray();

describe('seedCompanies', () => {
  const companies = [
    { key: 'empresa-x', name: 'Empresa X' },
    { key: 'empresa-y', name: 'Empresa Y' },
  ];

  beforeEach(() => db.collection('companies').deleteMany({}));

  it('insere na primeira execução e atualiza na segunda, sem duplicar', async () => {
    assert.deepEqual(await seedCompanies(db, companies), { inserted: 2, updated: 0 });
    assert.deepEqual(await seedCompanies(db, companies), { inserted: 0, updated: 2 });
    assert.equal(await db.collection('companies').countDocuments(), 2);
  });

  it('grava updatedAt com o horário do seed', async () => {
    const before = new Date();
    await seedCompanies(db, companies);

    for (const company of await findAll('companies', { key: 1 })) {
      assert.ok(company.updatedAt instanceof Date);
      assert.ok(company.updatedAt >= before);
    }
  });

  it('atualiza o name e remove atributos que saíram do arquivo', async () => {
    await seedCompanies(db, [{ key: 'empresa-x', name: 'Empresa X', segment: 'educação' }]);
    await seedCompanies(db, [{ key: 'empresa-x', name: 'Empresa X Renomeada' }]);

    const [company] = await findAll('companies', { key: 1 });
    assert.equal(company.name, 'Empresa X Renomeada');
    assert.equal('segment' in company, false);
  });

  it('preserva atributos desconhecidos e remove espaços das pontas', async () => {
    await seedCompanies(db, [{ key: ' empresa-x ', name: ' Empresa X ', segment: 'educação' }]);

    const [company] = await findAll('companies', { key: 1 });
    assert.equal(company.key, 'empresa-x');
    assert.equal(company.name, 'Empresa X');
    assert.equal(company.segment, 'educação');
  });

  it('mantém empresas que não estão no arquivo', async () => {
    await seedCompanies(db, companies);
    await seedCompanies(db, [companies[0]]);

    assert.deepEqual((await findAll('companies', { key: 1 })).map((c) => c.key), ['empresa-x', 'empresa-y']);
  });

  const invalidCases = [
    ['sem key', [{ name: 'Empresa X' }], '- [0].key: é obrigatório'],
    ['name vazio', [{ key: 'empresa-x', name: '  ' }], '- [0].name: não pode ser vazio'],
    ['key duplicada', [...companies, { key: 'empresa-x', name: 'Outra' }], '- [2].key: duplicado: "empresa-x"'],
    ['valor que não é lista', { key: 'empresa-x' }, '- (raiz): deve ser uma lista'],
    ['lista vazia', [], '- (raiz): deve ter ao menos 1 item'],
  ];

  for (const [name, input, expected] of invalidCases) {
    it(`rejeita ${name} sem gravar nada`, async () => {
      await assert.rejects(seedCompanies(db, input), (error) => {
        assert.ok(error.message.startsWith('companies.json inválido:\n'), error.message);
        assert.ok(error.message.includes(expected), error.message);
        return true;
      });
      assert.equal(await db.collection('companies').countDocuments(), 0);
    });
  }
});

describe('seedFields', () => {
  const field = (overrides) => ({ companyKey: 'empresa-x', order: 1, key: 'CAMPO_A', label: 'Campo A', type: 'text', required: true, ...overrides });
  const fields = [
    field(),
    field({ order: 2, key: 'CAMPO_B', type: 'select', options: [{ value: 'S', label: 'Sim' }] }),
    field({ order: 3, key: 'CAMPO_C', attached: [{ key: 'CAMPO_B', values: ['S'] }] }),
    field({ companyKey: 'empresa-y', key: 'CAMPO_A' }),
  ];
  const keysOf = async (companyKey) =>
    (await db.collection('fields').find({ companyKey }).sort({ order: 1 }).toArray()).map((f) => f.key);

  beforeEach(async () => {
    await db.collection('companies').deleteMany({});
    await db.collection('fields').deleteMany({});
    await seedCompanies(db, [
      { key: 'empresa-x', name: 'Empresa X' },
      { key: 'empresa-y', name: 'Empresa Y' },
    ]);
  });

  it('não duplica ao rodar duas vezes (G1)', async () => {
    assert.deepEqual(await seedFields(db, fields), { inserted: 4, updated: 0, removed: 0 });
    assert.deepEqual(await seedFields(db, fields), { inserted: 0, updated: 4, removed: 0 });
    assert.equal(await db.collection('fields').countDocuments(), 4);
  });

  it('grava o campo no formato do arquivo', async () => {
    await seedFields(db, fields);
    const stored = await db.collection('fields').findOne({ companyKey: 'empresa-x', key: 'CAMPO_B' }, { projection: { _id: 0 } });
    assert.deepEqual(stored, fields[1]);
  });

  it('atualiza label alterado (G2)', async () => {
    await seedFields(db, fields);
    await seedFields(db, [field({ label: 'Novo label' }), ...fields.slice(1)]);

    const stored = await db.collection('fields').findOne({ companyKey: 'empresa-x', key: 'CAMPO_A' });
    assert.equal(stored.label, 'Novo label');
  });

  it('remove campo que saiu do arquivo só da empresa presente no arquivo (G3)', async () => {
    await seedFields(db, fields);
    const result = await seedFields(db, [fields[0], fields[1]]);

    assert.equal(result.removed, 1);
    assert.deepEqual(await keysOf('empresa-x'), ['CAMPO_A', 'CAMPO_B']);
    assert.deepEqual(await keysOf('empresa-y'), ['CAMPO_A']);
  });

  it('remove attached que saiu do arquivo (G4)', async () => {
    await seedFields(db, fields);
    await seedFields(db, [...fields.slice(0, 2), field({ order: 3, key: 'CAMPO_C' }), fields[3]]);

    const stored = await db.collection('fields').findOne({ companyKey: 'empresa-x', key: 'CAMPO_C' });
    assert.equal('attached' in stored, false);
  });

  it('aceita type desconhecido, required ausente e atributos extras (D-15, G5b)', async () => {
    const { required, ...withoutRequired } = field({ type: 'cpf', mask: '000.000.000-00' });
    await seedFields(db, [withoutRequired]);

    const stored = await db.collection('fields').findOne({ key: 'CAMPO_A' }, { projection: { _id: 0 } });
    assert.deepEqual(stored, withoutRequired);
  });

  const invalidCases = [
    ['sem key', [field({ key: undefined })], '- [0].key: é obrigatório'],
    ['order não inteiro', [field({ order: 1.5 })], '- [0].order: deve ser um número inteiro'],
    ['required não booleano', [field({ required: 'sim' })], '- [0].required: deve ser true ou false'],
    ['companyKey sem empresa', [field({ companyKey: 'empresa-z' })], '- [0].companyKey: empresa não encontrada: "empresa-z"'],
    ['chave duplicada na empresa', [field(), field({ order: 2 })], '- [1].key: duplicado: "empresa-x/CAMPO_A"'],
    ['options mal formado', [field({ type: 'select', options: [{ value: 'S' }] })], '- [0].options[0].label: é obrigatório'],
    ['attached mal formado', [field({ attached: [{ key: 'CAMPO_B', values: 'S' }] })], '- [0].attached[0].values: deve ser uma lista'],
  ];

  for (const [name, input, expected] of invalidCases) {
    it(`rejeita ${name} sem gravar nada`, async () => {
      await assert.rejects(seedFields(db, input), (error) => {
        assert.ok(error.message.startsWith('fields.json inválido:\n'), error.message);
        assert.ok(error.message.includes(expected), error.message);
        return true;
      });
      assert.equal(await db.collection('fields').countDocuments(), 0);
    });
  }
});

describe('seedQueries', () => {
  const queries = {
    'empresa-x': ['frase um', { text: 'frase dois', topK: 3 }, '  frase três  '],
    'empresa-y': ['frase da y'],
  };
  const queriesOf = (companyKey) =>
    db.collection('queries').find({ companyKey }, { projection: { _id: 0 } }).sort({ position: 1 }).toArray();

  beforeEach(async () => {
    await db.collection('companies').deleteMany({});
    await db.collection('queries').deleteMany({});
    await seedCompanies(db, [
      { key: 'empresa-x', name: 'Empresa X' },
      { key: 'empresa-y', name: 'Empresa Y' },
    ]);
  });

  it('grava string sem topK, objeto com topK e position na ordem do arquivo', async () => {
    assert.deepEqual(await seedQueries(db, queries), { companies: 2, queries: 4 });

    assert.deepEqual(await queriesOf('empresa-x'), [
      { companyKey: 'empresa-x', text: 'frase um', position: 0 },
      { companyKey: 'empresa-x', text: 'frase dois', topK: 3, position: 1 },
      { companyKey: 'empresa-x', text: 'frase três', position: 2 },
    ]);
  });

  it('não duplica ao rodar duas vezes (G1)', async () => {
    await seedQueries(db, queries);
    await seedQueries(db, queries);
    assert.equal(await db.collection('queries').countDocuments(), 4);
  });

  it('substitui o conjunto só das empresas presentes no arquivo', async () => {
    await seedQueries(db, queries);
    await seedQueries(db, { 'empresa-x': ['frase nova'] });

    assert.deepEqual((await queriesOf('empresa-x')).map((q) => q.text), ['frase nova']);
    assert.deepEqual((await queriesOf('empresa-y')).map((q) => q.text), ['frase da y']);
  });

  it('lista vazia remove as frases da empresa', async () => {
    await seedQueries(db, queries);
    assert.deepEqual(await seedQueries(db, { 'empresa-x': [] }), { companies: 1, queries: 0 });
    assert.deepEqual(await queriesOf('empresa-x'), []);
  });

  const invalidCases = [
    ['raiz que é lista', ['frase'], '- (raiz): deve ser um objeto { companyKey: [frases] }'],
    ['frases que não são lista', { 'empresa-x': 'frase' }, '- empresa-x: deve ser uma lista'],
    ['item inválido', { 'empresa-x': [42] }, '- empresa-x[0]: deve ser uma string ou um objeto { text, topK }'],
    ['text vazio', { 'empresa-x': ['  '] }, '- empresa-x[0].text: não pode ser vazio'],
    ['topK zero', { 'empresa-x': [{ text: 'frase', topK: 0 }] }, '- empresa-x[0].topK: deve ser maior ou igual a 1'],
    ['empresa inexistente', { 'empresa-z': ['frase'] }, '- empresa-z: empresa não encontrada: "empresa-z"'],
  ];

  for (const [name, input, expected] of invalidCases) {
    it(`rejeita ${name} sem gravar nada`, async () => {
      await assert.rejects(seedQueries(db, input), (error) => {
        assert.ok(error.message.startsWith('queries.json inválido:\n'), error.message);
        assert.ok(error.message.includes(expected), error.message);
        return true;
      });
      assert.equal(await db.collection('queries').countDocuments(), 0);
    });
  }
});
