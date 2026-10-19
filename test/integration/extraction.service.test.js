import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createExtraction } from '../../src/services/extraction.service.js';
import { connectMongo, closeMongo } from '../../src/integrations/mongo/client.js';
import { ensureIndexes } from '../../src/integrations/mongo/indexes.js';
import { readJsonFile, seedCompanies, seedFields, seedQueries } from '../../scripts/seed.js';
import { promptLength } from '../../src/domain/prompt.js';
import { BadGatewayError, BadRequestError, NotFoundError } from '../../src/errors/http-errors.js';
import { extract, loadEvidence } from '../../lia-mock/src/chat.js';
import { embed as mockEmbed } from '../../lia-mock/src/embeddings.js';
import { README_EXPECTED } from '../fixtures/readme-expected.js';

const TEST_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/mini-lia-test-extraction-service';
const ROOT = join(import.meta.dirname, '..', '..');
const evidence = loadEvidence([join(ROOT, 'lia-mock', 'evidence')]);

const rag = { chunkSize: 1200, chunkOverlap: 200, defaultTopK: 2 };
const silentLogger = { warn() {}, error() {} };

// "Modelo" real do mock, em processo: mesma detecção de keys e evidências, sem servidor.
function mockLia({ chatText } = {}) {
  const calls = { chat: [], embed: [] };
  return {
    calls,
    chat: async (prompt) => {
      calls.chat.push(prompt);
      if (chatText) return chatText;
      return extract([prompt.system, ...prompt.messages.map((m) => m.content)].join('\n\n'), evidence).text;
    },
    embed: async (inputs) => {
      calls.embed.push(inputs);
      return inputs.map(mockEmbed);
    },
  };
}

const deps = (overrides = {}) => ({ lia: mockLia(), rag, maxPromptChars: 16000, logger: silentLogger, ...overrides });

const pdfFile = async (name, buffer) => ({
  originalname: name,
  size: (buffer ??= await readFile(join(ROOT, 'data', 'documents', name))).length,
  buffer,
});

async function syntheticPdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    doc.addPage().drawText(`Pagina ${i} do documento de teste`, { x: 50, y: 700, size: 12, font });
  }
  return Buffer.from(await doc.save());
}

describe('createExtraction', () => {
  let db;
  const count = () => db.collection('extractions').countDocuments();

  before(async () => {
    db = await connectMongo(TEST_URI);
    await db.dropDatabase();
    await ensureIndexes(db);
    const companies = await readJsonFile(join(ROOT, 'data', 'companies.json'));
    await seedCompanies(db, [...companies, { key: 'empresa-tipo-novo', name: 'Empresa com tipo novo' }]);
    await seedFields(db, [
      ...(await readJsonFile(join(ROOT, 'data', 'fields.json'))),
      { companyKey: 'empresa-tipo-novo', order: 1, key: 'CAMPO_CPF', label: 'CPF', type: 'cpf' },
      { companyKey: 'empresa-tipo-novo', order: 2, key: 'CAMPO_TEXTO', label: 'Texto', type: 'text' },
    ]);
    await seedQueries(db, await readJsonFile(join(ROOT, 'data', 'queries.json')));
  });

  beforeEach(() => db.collection('extractions').deleteMany({}));

  after(async () => {
    await db.dropDatabase();
    await closeMongo();
  });

  it('acme-edu + processo-curto → fullContent com o texto inteiro, formData do README, gravado', async () => {
    const lia = mockLia();
    const file = await pdfFile('processo-curto.pdf');
    const result = await createExtraction('acme-edu', file, deps({ lia }));
    const expected = README_EXPECTED['processo-curto'];

    assert.equal(result.companyKey, 'acme-edu');
    assert.equal(result.strategy, 'fullContent');
    assert.equal(result.usedChunks, 0);
    assert.deepEqual(result.formData, expected.formData);
    assert.deepEqual(result.missingRequired, expected.missingRequired);
    assert.match(result.id, /^[0-9a-f]{24}$/);
    assert.ok(result.createdAt instanceof Date);
    assert.equal(lia.calls.embed.length, 0);
    assert.ok(lia.calls.chat[0].messages[0].content.includes('Processo nº 1012345-67.2025.8.26.0114'));

    const saved = await db.collection('extractions').findOne({});
    assert.equal(saved._id.toString(), result.id);
    assert.deepEqual(saved.file, { name: 'processo-curto.pdf', size: file.size, pages: 3 });
    assert.deepEqual(saved.formData, expected.formData);
  });

  it('rodovia-sul + processo-longo → chunked, usedChunks = trechos no prompt, formData do README', async () => {
    const lia = mockLia();
    const result = await createExtraction('rodovia-sul', await pdfFile('processo-longo.pdf'), deps({ lia }));
    const expected = README_EXPECTED['processo-longo'];

    assert.equal(result.strategy, 'chunked');
    assert.deepEqual(result.formData, expected.formData);
    assert.deepEqual(result.missingRequired, expected.missingRequired);
    assert.equal(lia.calls.embed.length, 1);

    const content = lia.calls.chat[0].messages[0].content;
    const excerpts = content.split('Trechos do documento:\n')[1].split('\n---').length - 1;
    assert.ok(result.usedChunks > 0);
    assert.equal(result.usedChunks, excerpts);
    assert.ok(promptLength(lia.calls.chat[0]) <= 16000);
  });

  it('orçamento menor → corta trechos e o prompt cabe', async () => {
    const lia = mockLia();
    const full = await createExtraction('rodovia-sul', await pdfFile('processo-longo.pdf'), deps());
    const cut = await createExtraction('rodovia-sul', await pdfFile('processo-longo.pdf'), deps({ lia, maxPromptChars: 6000 }));
    assert.ok(cut.usedChunks < full.usedChunks);
    assert.ok(promptLength(lia.calls.chat[0]) <= 6000);
  });

  it('fronteira: 5 páginas → fullContent; 6 páginas → chunked', async () => {
    const five = await createExtraction('acme-edu', await pdfFile('cinco.pdf', await syntheticPdf(5)), deps());
    const six = await createExtraction('acme-edu', await pdfFile('seis.pdf', await syntheticPdf(6)), deps());
    assert.equal(five.strategy, 'fullContent');
    assert.equal(six.strategy, 'chunked');
  });

  it('empresa inexistente sem arquivo → 404 (antes do 400), nada gravado', async () => {
    await assert.rejects(createExtraction('empresa-z', undefined, deps()), NotFoundError);
    assert.equal(await count(), 0);
  });

  it('empresa válida sem arquivo → 400 FILE_REQUIRED', async () => {
    await assert.rejects(createExtraction('acme-edu', undefined, deps()), (error) => {
      assert.ok(error instanceof BadRequestError);
      assert.equal(error.code, 'FILE_REQUIRED');
      return true;
    });
  });

  it('PDF corrompido → 400 INVALID_PDF, nada gravado', async () => {
    const file = await pdfFile('quebrado.pdf', Buffer.from('%PDF-1.4 conteúdo quebrado'));
    await assert.rejects(createExtraction('acme-edu', file, deps()), (error) => error.code === 'INVALID_PDF');
    assert.equal(await count(), 0);
  });

  it('resposta da IA sem objeto JSON → 502 LIA_INVALID_RESPONSE, nada gravado', async () => {
    const lia = mockLia({ chatText: 'Não consegui extrair os campos.' });
    await assert.rejects(createExtraction('acme-edu', await pdfFile('processo-curto.pdf'), deps({ lia })), (error) => {
      assert.ok(error instanceof BadGatewayError);
      assert.equal(error.code, 'LIA_INVALID_RESPONSE');
      return true;
    });
    assert.equal(await count(), 0);
  });

  it('falha da chamada à IA → o 502 sobe intacto, nada gravado', async () => {
    const failure = new BadGatewayError('Falha na chamada à IA', { code: 'LIA_ERROR', details: { status: 413 } });
    const lia = { ...mockLia(), chat: async () => { throw failure; } };
    await assert.rejects(createExtraction('acme-edu', await pdfFile('processo-curto.pdf'), deps({ lia })), (error) => error === failure);
    assert.equal(await count(), 0);
  });

  it('type desconhecido → um warn com as keys afetadas, valor tratado como text', async () => {
    const warnings = [];
    const lia = mockLia({ chatText: '```json\n{ "CAMPO_CPF": " 123.456.789-09 ", "CAMPO_TEXTO": "x" }\n```' });
    const logger = { ...silentLogger, warn: (message) => warnings.push(message) };
    const result = await createExtraction('empresa-tipo-novo', await pdfFile('processo-curto.pdf'), deps({ lia, logger }));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /CAMPO_CPF/);
    assert.doesNotMatch(warnings[0], /CAMPO_TEXTO/);
    assert.equal(result.formData.CAMPO_CPF, '123.456.789-09');
  });
});
