import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readPdf } from '../../src/integrations/pdf/pdf-reader.js';
import { BadRequestError } from '../../src/errors/http-errors.js';

const loadDocument = (name) => readFile(new URL(`../../data/documents/${name}`, import.meta.url));

const isInvalidPdf = (error) => {
  assert.ok(error instanceof BadRequestError);
  assert.equal(error.status, 400);
  assert.equal(error.code, 'INVALID_PDF');
  assert.ok(error.cause);
  return true;
};

describe('readPdf', () => {
  it('lê o processo-curto: 3 páginas e o texto do documento', async () => {
    const { text, pages } = await readPdf(await loadDocument('processo-curto.pdf'));
    assert.equal(pages, 3);
    assert.ok(text.includes('1012345-67.2025.8.26.0114'));
  });

  it('lê o processo-longo: 18 páginas e o texto do documento', async () => {
    const { text, pages } = await readPdf(await loadDocument('processo-longo.pdf'));
    assert.equal(pages, 18);
    assert.ok(text.includes('5004321-10.2025.8.21.0001'));
  });

  it('mantém o buffer de entrada intacto', async () => {
    const buffer = await loadDocument('processo-curto.pdf');
    const copy = Buffer.from(buffer);
    await readPdf(buffer);
    assert.equal(buffer.byteLength, copy.byteLength);
    assert.ok(buffer.equals(copy));
  });

  it('bytes que não são PDF → BadRequestError INVALID_PDF', async () => {
    await assert.rejects(readPdf(Buffer.from('apenas texto, não é um PDF')), isInvalidPdf);
  });

  it('cabeçalho %PDF- com o resto corrompido → BadRequestError INVALID_PDF', async () => {
    const pdf = await loadDocument('processo-curto.pdf');
    const truncated = Buffer.concat([pdf.subarray(0, 64), Buffer.from('lixo')]);
    await assert.rejects(readPdf(truncated), isInvalidPdf);
  });
});
