import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectMongo, getDb, closeMongo } from '../../src/integrations/mongo/client.js';

const TEST_URI = process.env.MONGO_TEST_URI ?? 'mongodb://localhost:27017/mini-lia-test';

describe('mongo client', () => {
  after(closeMongo);

  it('getDb lança erro antes de conectar', () => {
    assert.throws(() => getDb(), /MongoDB não conectado/);
  });

  it('conecta no banco da URI e responde ao ping', async () => {
    const db = await connectMongo(TEST_URI);

    assert.equal(db.databaseName, 'mini-lia-test');
    assert.equal(getDb(), db);
    assert.deepEqual(await db.command({ ping: 1 }), { ok: 1 });
  });

  it('reaproveita a conexão existente', async () => {
    assert.equal(await connectMongo(TEST_URI), getDb());
  });

  it('fecha, limpa o estado e tolera fechar de novo', async () => {
    await closeMongo();
    assert.throws(() => getDb(), /MongoDB não conectado/);
    await closeMongo();
  });

  it('reconecta depois de fechar', async () => {
    const db = await connectMongo(TEST_URI);
    assert.deepEqual(await db.command({ ping: 1 }), { ok: 1 });
  });
});
