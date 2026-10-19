import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectMongo, closeMongo } from '../../src/integrations/mongo/client.js';
import { ensureIndexes } from '../../src/integrations/mongo/indexes.js';
import { readJsonFile, seedCompanies, seedFields, seedQueries } from '../../scripts/seed.js';
import { extract, loadEvidence } from '../../lia-mock/src/chat.js';
import { embed } from '../../lia-mock/src/embeddings.js';
import { README_EXPECTED } from '../fixtures/readme-expected.js';
import { testConfig, silentLogger } from '../fixtures/test-app.js';

const TEST_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/mini-lia-test-extraction-routes';
const ROOT = join(import.meta.dirname, '..', '..');
const evidence = loadEvidence([join(ROOT, 'lia-mock', 'evidence')]);
const readDocument = (name) => readFile(join(ROOT, 'data', 'documents', name));

// Stub HTTP do LIA Mock com a lógica do próprio mock (extract/embed), sem depender do serviço rodando.
async function startLiaStub() {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const payload =
      req.url === '/v1/chat'
        ? { text: extract([body.system || '', ...body.messages.map((m) => m.content)].join('\n\n'), evidence).text }
        : { vectors: body.inputs.map(embed), dimensions: 512 };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

async function closedPortUrl() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

const expectError = (res, status, code) => {
  assert.equal(res.status, status);
  assert.match(res.headers['content-type'], /json/);
  assert.equal(res.body.error.code, code);
};

describe('rotas de extração', () => {
  let db;
  let stub;
  let app;
  let curto;
  let longo;
  const count = () => db.collection('extractions').countDocuments();

  before(async () => {
    db = await connectMongo(TEST_URI);
    await db.dropDatabase();
    await ensureIndexes(db);
    await seedCompanies(db, await readJsonFile(join(ROOT, 'data', 'companies.json')));
    await seedFields(db, await readJsonFile(join(ROOT, 'data', 'fields.json')));
    await seedQueries(db, await readJsonFile(join(ROOT, 'data', 'queries.json')));

    stub = await startLiaStub();
    const config = testConfig({ LIA_BASE_URL: `http://127.0.0.1:${stub.address().port}`, UPLOAD_MAX_BYTES: '1000000' });
    app = createApp({ config, logger: silentLogger });
    curto = await readDocument('processo-curto.pdf');
    longo = await readDocument('processo-longo.pdf');
  });

  after(async () => {
    stub.closeAllConnections();
    stub.close();
    await db.dropDatabase();
    await closeMongo();
  });

  describe('POST /companies/:companyKey/extractions + GET /extractions/:id', () => {
    for (const [doc, expected] of Object.entries(README_EXPECTED)) {
      it(`${expected.companyKey} + ${doc} → 201 no contrato, e o GET devolve o mesmo corpo`, async () => {
        const post = await request(app)
          .post(`/companies/${expected.companyKey}/extractions`)
          .attach('file', doc === 'processo-curto' ? curto : longo, `${doc}.pdf`);

        assert.equal(post.status, 201);
        const { id, createdAt, usedChunks, ...rest } = post.body;
        assert.match(id, /^[0-9a-f]{24}$/);
        assert.ok(!Number.isNaN(Date.parse(createdAt)));
        assert.deepEqual(rest, {
          companyKey: expected.companyKey,
          strategy: expected.strategy,
          formData: expected.formData,
          missingRequired: expected.missingRequired,
        });
        assert.equal(usedChunks === 0, expected.strategy === 'fullContent');

        const get = await request(app).get(`/extractions/${id}`);
        assert.equal(get.status, 200);
        assert.deepEqual(get.body, post.body);
      });
    }
  });

  describe('erros', () => {
    for (const id of ['0123456789abcdef01234567', 'abc']) {
      it(`GET /extractions/${id} → 404 EXTRACTION_NOT_FOUND`, async () => {
        expectError(await request(app).get(`/extractions/${id}`), 404, 'EXTRACTION_NOT_FOUND');
      });
    }

    it('POST para empresa inexistente sem arquivo → 404 COMPANY_NOT_FOUND', async () => {
      expectError(await request(app).post('/companies/empresa-z/extractions'), 404, 'COMPANY_NOT_FOUND');
    });

    it('POST para empresa inexistente com arquivo → 404 COMPANY_NOT_FOUND', async () => {
      const res = await request(app).post('/companies/empresa-z/extractions').attach('file', curto, 'a.pdf');
      expectError(res, 404, 'COMPANY_NOT_FOUND');
    });

    it('POST sem arquivo → 400 FILE_REQUIRED', async () => {
      expectError(await request(app).post('/companies/acme-edu/extractions'), 400, 'FILE_REQUIRED');
    });

    it('POST com .txt renomeado → 400 INVALID_PDF', async () => {
      const res = await request(app)
        .post('/companies/acme-edu/extractions')
        .attach('file', Buffer.from('não sou PDF'), { filename: 'falso.pdf', contentType: 'application/pdf' });
      expectError(res, 400, 'INVALID_PDF');
    });

    it('POST com o arquivo em outro campo → 400 INVALID_UPLOAD', async () => {
      const res = await request(app).post('/companies/acme-edu/extractions').attach('document', curto, 'a.pdf');
      expectError(res, 400, 'INVALID_UPLOAD');
    });

    it('POST acima do limite → 413 FILE_TOO_LARGE', async () => {
      const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1_000_001)]);
      const res = await request(app).post('/companies/acme-edu/extractions').attach('file', big, 'grande.pdf');
      expectError(res, 413, 'FILE_TOO_LARGE');
    });

    it('LIA fora do ar → 502 LIA_UNAVAILABLE, nada gravado', async () => {
      const before = await count();
      const offline = createApp({ config: testConfig({ LIA_BASE_URL: await closedPortUrl() }), logger: silentLogger });
      const res = await request(offline).post('/companies/acme-edu/extractions').attach('file', curto, 'a.pdf');
      expectError(res, 502, 'LIA_UNAVAILABLE');
      assert.equal(await count(), before);
    });
  });
});
