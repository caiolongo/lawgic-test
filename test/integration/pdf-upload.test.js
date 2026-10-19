import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import express from 'express';
import request from 'supertest';
import { pdfUpload, assertPdfFile } from '../../src/middlewares/pdf-upload.js';
import { errorHandler } from '../../src/middlewares/error-handler.js';

const MAX_BYTES = 64 * 1024;
const silentLogger = { error() {} };

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.post('/upload', pdfUpload({ maxBytes: MAX_BYTES }), (req, res) => {
    assertPdfFile(req.file);
    res.json({ name: req.file.originalname, size: req.file.size, buffer: req.file.buffer.toString('base64') });
  });
  app.use(errorHandler({ logger: silentLogger }));
  return app;
}

const app = createTestApp();
const upload = () => request(app).post('/upload');
const pdf = await readFile(new URL('../../data/documents/processo-curto.pdf', import.meta.url));

const withSignatureAt = (offset) =>
  Buffer.concat([Buffer.alloc(offset, ' '), Buffer.from('%PDF-1.4\n')]);

const expectError = (res, status, code) => {
  assert.equal(res.status, status);
  assert.equal(res.body.error.code, code);
  assert.equal(typeof res.body.error.message, 'string');
};

describe('pdfUpload + assertPdfFile', () => {
  it('aceita PDF enviado como application/octet-stream, com o buffer intacto', async () => {
    const res = await upload().attach('file', pdf, { filename: 'processo.bin', contentType: 'application/octet-stream' });
    assert.equal(res.status, 200);
    assert.equal(res.body.size, pdf.length);
    assert.ok(Buffer.from(res.body.buffer, 'base64').equals(pdf));
  });

  it('nome de arquivo com acento chega em UTF-8', async () => {
    const res = await upload().attach('file', pdf, 'petição-ação.pdf');
    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'petição-ação.pdf');
  });

  it('multipart sem arquivo → 400 FILE_REQUIRED', async () => {
    expectError(await upload().field('outro', 'valor'), 400, 'FILE_REQUIRED');
  });

  it('requisição sem corpo → 400 FILE_REQUIRED', async () => {
    expectError(await upload(), 400, 'FILE_REQUIRED');
  });

  it('corpo JSON (não é multipart) → 400 FILE_REQUIRED', async () => {
    expectError(await upload().send({ file: 'processo.pdf' }), 400, 'FILE_REQUIRED');
  });

  it('arquivo em campo com outro nome → 400 INVALID_UPLOAD', async () => {
    expectError(await upload().attach('document', pdf, 'processo.pdf'), 400, 'INVALID_UPLOAD');
  });

  it('dois arquivos no campo file → 400 INVALID_UPLOAD', async () => {
    const res = await upload().attach('file', pdf, 'a.pdf').attach('file', pdf, 'b.pdf');
    expectError(res, 400, 'INVALID_UPLOAD');
  });

  it('multipart truncado → 400 INVALID_UPLOAD', async () => {
    const res = await upload()
      .set('Content-Type', 'multipart/form-data; boundary=limite')
      .send('--limite\r\nContent-Disposition: form-data; name="file"; filename="a.pdf"\r\n\r\n%PDF-1.4 corte');
    expectError(res, 400, 'INVALID_UPLOAD');
  });

  it('multipart sem boundary → 400 INVALID_UPLOAD', async () => {
    const res = await upload().set('Content-Type', 'multipart/form-data').send('qualquer coisa');
    expectError(res, 400, 'INVALID_UPLOAD');
  });

  it('arquivo acima do limite → 413 FILE_TOO_LARGE em JSON', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(MAX_BYTES)]);
    const res = await upload().attach('file', big, 'grande.pdf');
    expectError(res, 413, 'FILE_TOO_LARGE');
    assert.deepEqual(res.body.error.details, { maxBytes: MAX_BYTES });
  });

  it('.txt renomeado para .pdf, com mimetype de PDF → 400 INVALID_PDF', async () => {
    const res = await upload().attach('file', Buffer.from('apenas texto'), { filename: 'falso.pdf', contentType: 'application/pdf' });
    expectError(res, 400, 'INVALID_PDF');
  });

  it('arquivo vazio → 400 INVALID_PDF', async () => {
    expectError(await upload().attach('file', Buffer.alloc(0), 'vazio.pdf'), 400, 'INVALID_PDF');
  });

  for (const offset of [0, 1000, 1019]) {
    it(`%PDF- começando no byte ${offset} (inteiro nos primeiros 1024) → aceito`, async () => {
      assert.equal((await upload().attach('file', withSignatureAt(offset), 'a.pdf')).status, 200);
    });
  }

  for (const offset of [1020, 1024]) {
    it(`%PDF- começando no byte ${offset} (não cabe nos primeiros 1024) → 400 INVALID_PDF`, async () => {
      expectError(await upload().attach('file', withSignatureAt(offset), 'a.pdf'), 400, 'INVALID_PDF');
    });
  }
});
