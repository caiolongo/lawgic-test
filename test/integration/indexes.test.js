import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectMongo, closeMongo } from '../../src/integrations/mongo/client.js';
import { ensureIndexes } from '../../src/integrations/mongo/indexes.js';

const TEST_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/mini-lia-test-indexes';

describe('ensureIndexes', () => {
  let db;

  before(async () => {
    db = await connectMongo(TEST_URI);
    await db.dropDatabase();
  });

  after(async () => {
    await db.dropDatabase();
    await closeMongo();
  });

  it('é idempotente', async () => {
    await ensureIndexes(db);
    await ensureIndexes(db);
  });

  it('cria os índices esperados', async () => {
    const indexesOf = async (name) =>
      (await db.collection(name).indexes())
        .filter((index) => index.name !== '_id_')
        .map(({ key, unique }) => ({ key, unique: unique === true }));

    assert.deepEqual(await indexesOf('companies'), [{ key: { key: 1 }, unique: true }]);
    assert.deepEqual(await indexesOf('fields'), [
      { key: { companyKey: 1, key: 1 }, unique: true },
      { key: { companyKey: 1, order: 1 }, unique: false },
    ]);
    assert.deepEqual(await indexesOf('queries'), [{ key: { companyKey: 1, position: 1 }, unique: true }]);
    assert.deepEqual(await indexesOf('extractions'), [{ key: { companyKey: 1, createdAt: -1 }, unique: false }]);
  });

  const duplicates = [
    ['companies', { key: 'empresa-x' }],
    ['fields', { companyKey: 'empresa-x', key: 'CAMPO_A' }],
    ['queries', { companyKey: 'empresa-x', position: 0 }],
  ];

  for (const [collection, doc] of duplicates) {
    it(`rejeita duplicata em ${collection}`, async () => {
      await db.collection(collection).insertOne({ ...doc });
      await assert.rejects(db.collection(collection).insertOne({ ...doc }), { code: 11000 });
    });
  }
});
