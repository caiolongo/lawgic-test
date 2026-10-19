import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chunkText } from '../../src/domain/chunking.js';
import { readPdf } from '../../src/integrations/pdf/pdf-reader.js';

const reconstruct = (chunks, overlap) => chunks.map((chunk, i) => (i === 0 ? chunk : chunk.slice(overlap))).join('');

function assertEverySpanFits(text, chunks, span) {
  for (let start = 0; start + span <= text.length; start++) {
    const piece = text.slice(start, start + span);
    assert.ok(chunks.some((chunk) => chunk.includes(piece)), `trecho em ${start} não cabe em nenhum chunk`);
  }
}

const synthetic = Array.from({ length: 300 }, (_, i) => `palavra${i}`).join(' \n');

describe('chunkText', () => {
  it('nenhum chunk passa de size e juntar descontando o overlap reconstrói o texto', () => {
    const chunks = chunkText(synthetic, { size: 100, overlap: 30 });
    assert.ok(chunks.every((chunk) => chunk.length <= 100));
    assert.equal(reconstruct(chunks, 30), synthetic);
  });

  it('chunks são fatias exatas do texto, sem reescrever espaços', () => {
    const text = 'AÇÃO\nDE  INDENIZAÇÃO\tR$\n4.870,00 '.repeat(5);
    const chunks = chunkText(text, { size: 40, overlap: 15 });
    assert.ok(chunks.every((chunk) => text.includes(chunk)));
    assert.equal(chunks[0], text.slice(0, 40));
  });

  it('todo trecho de até overlap caracteres cabe inteiro em algum chunk (texto sintético)', () => {
    const chunks = chunkText(synthetic, { size: 100, overlap: 30 });
    assertEverySpanFits(synthetic, chunks, 30);
  });

  it('texto vazio → []', () => {
    assert.deepEqual(chunkText('', { size: 100, overlap: 30 }), []);
  });

  it('texto menor ou igual a size → 1 chunk', () => {
    assert.deepEqual(chunkText('abc', { size: 100, overlap: 30 }), ['abc']);
    const exact = 'x'.repeat(100);
    assert.deepEqual(chunkText(exact, { size: 100, overlap: 30 }), [exact]);
  });

  it('não gera chunk final já contido no anterior', () => {
    const cases = [
      [101, [[0, 100], [70, 101]]],
      [170, [[0, 100], [70, 170]]],
      [171, [[0, 100], [70, 170], [140, 171]]],
    ];
    for (const [length, ranges] of cases) {
      const text = Array.from({ length }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');
      assert.deepEqual(
        chunkText(text, { size: 100, overlap: 30 }),
        ranges.map(([start, end]) => text.slice(start, end)),
        `texto de ${length}`,
      );
    }
  });

  for (const [size, overlap] of [[100, 100], [100, 150]]) {
    it(`overlap ${overlap} >= size ${size} → RangeError`, () => {
      assert.throws(() => chunkText('qualquer texto', { size, overlap }), RangeError);
    });
  }

  describe('processo-longo real (1200 / 200)', async () => {
    const { text } = await readPdf(await readFile(new URL('../../data/documents/processo-longo.pdf', import.meta.url)));
    const chunks = chunkText(text, { size: 1200, overlap: 200 });

    it('reconstrói o texto e todo trecho de 200 caracteres cabe em algum chunk', () => {
      assert.equal(reconstruct(chunks, 200), text);
      assertEverySpanFits(text, chunks, 200);
    });

    it('cada evidência pública do mock cabe inteira em algum chunk', async () => {
      const normalize = (value) => value.normalize('NFC').replace(/\s+/g, ' ').toLowerCase();
      const evidence = JSON.parse(await readFile(new URL('../../lia-mock/evidence/public.json', import.meta.url), 'utf8'));
      const entries = evidence.entries.filter((entry) => entry.doc === 'processo-longo');
      assert.ok(entries.length > 0);
      for (const entry of entries) {
        assert.ok(chunks.some((chunk) => normalize(chunk).includes(normalize(entry.match))), entry.key);
      }
    });
  });
});
