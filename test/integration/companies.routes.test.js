import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { testConfig, silentLogger } from '../fixtures/test-app.js';
import { connectMongo, closeMongo } from '../../src/integrations/mongo/client.js';
import { ensureIndexes } from '../../src/integrations/mongo/indexes.js';
import { readJsonFile, seedCompanies, seedFields } from '../../scripts/seed.js';

const TEST_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/mini-lia-test-routes';
const DATA_DIR = join(import.meta.dirname, '..', '..', 'data');

describe('GET /companies/:companyKey/fields', () => {
  const app = createApp({ config: testConfig(), logger: silentLogger });
  let db;
  let companies;
  let fields;

  before(async () => {
    db = await connectMongo(TEST_URI);
    await db.dropDatabase();
    await ensureIndexes(db);

    companies = await readJsonFile(join(DATA_DIR, 'companies.json'));
    fields = await readJsonFile(join(DATA_DIR, 'fields.json'));
    await seedCompanies(db, [...companies, { key: 'empresa-sem-campos', name: 'Empresa sem campos' }]);
    await seedFields(db, fields);
  });

  after(async () => {
    await db.dropDatabase();
    await closeMongo();
  });

  it('devolve, para cada empresa de data/, os campos de fields.json ordenados por order', async () => {
    for (const { key } of companies) {
      const expected = fields.filter((field) => field.companyKey === key).toSorted((a, b) => a.order - b.order);

      const res = await request(app).get(`/companies/${key}/fields`).expect(200).expect('Content-Type', /json/);

      assert.ok(expected.length > 0, key);
      assert.deepEqual(res.body, expected, key);
    }
  });

  it('responde 404 COMPANY_NOT_FOUND para empresa inexistente', async () => {
    const res = await request(app).get('/companies/empresa-inexistente/fields').expect(404);

    assert.deepEqual(res.body, {
      error: {
        code: 'COMPANY_NOT_FOUND',
        message: 'Empresa não encontrada',
        details: { companyKey: 'empresa-inexistente' },
      },
    });
  });

  it('compara a chave exatamente (F5)', async () => {
    const res = await request(app).get(`/companies/${companies[0].key.toUpperCase()}/fields`).expect(404);
    assert.equal(res.body.error.code, 'COMPANY_NOT_FOUND');
  });

  it('responde 200 com lista vazia para empresa sem campos', async () => {
    const res = await request(app).get('/companies/empresa-sem-campos/fields').expect(200);
    assert.deepEqual(res.body, []);
  });
});
