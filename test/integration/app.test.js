import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { testConfig, silentLogger } from '../fixtures/test-app.js';

describe('createApp', () => {
  const app = createApp({ config: testConfig(), logger: silentLogger });

  it('GET /health responde 200 com status ok', async () => {
    const res = await request(app).get('/health').expect(200).expect('Content-Type', /json/);
    assert.deepEqual(res.body, { status: 'ok' });
  });

  it('não expõe o header x-powered-by', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('responde 404 em JSON para rota inexistente', async () => {
    const res = await request(app).get('/nao-existe').expect(404).expect('Content-Type', /json/);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  });

  it('responde 400 INVALID_JSON para JSON malformado', async () => {
    const res = await request(app).post('/health').set('Content-Type', 'application/json').send('{"a":').expect(400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });
});
