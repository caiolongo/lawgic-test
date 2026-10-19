import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile } from '../../scripts/seed.js';

describe('readJsonFile', () => {
  let dir;
  const file = (name) => join(dir, name);

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mini-lia-'));
    await writeFile(file('valid.json'), '[{ "key": "empresa-x" }]');
    await writeFile(file('bom.json'), '\uFEFF{ "a": 1 }');
    await writeFile(file('invalid.json'), '{ "a": ');
    await writeFile(file('empty.json'), '');
  });

  after(() => rm(dir, { recursive: true, force: true }));

  it('lê e faz o parse do JSON', async () => {
    assert.deepEqual(await readJsonFile(file('valid.json')), [{ key: 'empresa-x' }]);
  });

  it('ignora o BOM no início do arquivo', async () => {
    assert.deepEqual(await readJsonFile(file('bom.json')), { a: 1 });
  });

  it('informa o caminho quando o arquivo não existe', async () => {
    const path = file('missing.json');
    await assert.rejects(readJsonFile(path), { message: `Arquivo não encontrado: ${path}` });
  });

  for (const name of ['invalid.json', 'empty.json']) {
    it(`informa o caminho e preserva a causa para ${name}`, async () => {
      const path = file(name);
      await assert.rejects(readJsonFile(path), (error) => {
        assert.ok(error.message.startsWith(`JSON inválido em ${path}: `), error.message);
        assert.ok(error.cause instanceof SyntaxError);
        return true;
      });
    });
  }
});
