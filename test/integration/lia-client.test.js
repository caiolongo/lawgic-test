import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLiaClient } from '../../src/integrations/lia/lia.client.js';
import { BadGatewayError } from '../../src/errors/http-errors.js';

const servers = [];

async function startStub(handler) {
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    handler({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : undefined }, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

async function closedBaseUrl() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return `http://127.0.0.1:${port}`;
}

const reply = (status, body) => (req, res) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

const isBadGateway = (code, details = {}) => (error) => {
  assert.ok(error instanceof BadGatewayError);
  assert.equal(error.status, 502);
  assert.equal(error.code, code);
  for (const [key, value] of Object.entries(details)) assert.equal(error.details[key], value);
  return true;
};

const MESSAGES = [{ role: 'user', content: 'texto' }];

after(() => {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

describe('createLiaClient().chat', () => {
  it('envia { system, messages } para /v1/chat e devolve o text', async () => {
    let received;
    const baseUrl = await startStub((req, res) => {
      received = req;
      reply(200, { text: 'resposta', usage: {}, model: 'lia-mock-1' })(req, res);
    });
    const text = await createLiaClient({ baseUrl, timeoutMs: 1000 }).chat({ system: 'sys', messages: MESSAGES });
    assert.equal(text, 'resposta');
    assert.equal(received.method, 'POST');
    assert.equal(received.url, '/v1/chat');
    assert.deepEqual(received.body, { system: 'sys', messages: MESSAGES });
  });

  it('text vazio é uma resposta válida', async () => {
    const baseUrl = await startStub(reply(200, { text: '' }));
    assert.equal(await createLiaClient({ baseUrl, timeoutMs: 1000 }).chat({ messages: MESSAGES }), '');
  });

  it('413 context_length_exceeded → 502 LIA_ERROR com status e upstreamCode', async () => {
    const baseUrl = await startStub(reply(413, { error: { code: 'context_length_exceeded', message: 'grande' } }));
    await assert.rejects(
      createLiaClient({ baseUrl, timeoutMs: 1000 }).chat({ messages: MESSAGES }),
      isBadGateway('LIA_ERROR', { endpoint: '/v1/chat', status: 413, upstreamCode: 'context_length_exceeded' }),
    );
  });

  it('500 com corpo que não é JSON → 502 LIA_ERROR sem upstreamCode', async () => {
    const baseUrl = await startStub(reply(500, 'erro interno'));
    await assert.rejects(
      createLiaClient({ baseUrl, timeoutMs: 1000 }).chat({ messages: MESSAGES }),
      isBadGateway('LIA_ERROR', { status: 500, upstreamCode: undefined }),
    );
  });

  it('2xx com corpo que não é JSON → 502 LIA_INVALID_RESPONSE', async () => {
    const baseUrl = await startStub(reply(200, '<html>'));
    await assert.rejects(
      createLiaClient({ baseUrl, timeoutMs: 1000 }).chat({ messages: MESSAGES }),
      isBadGateway('LIA_INVALID_RESPONSE', { endpoint: '/v1/chat' }),
    );
  });

  for (const [name, body] of [
    ['sem text', { usage: {} }],
    ['text que não é string', { text: { CAMPO: 'x' } }],
    ['JSON null', 'null'],
  ]) {
    it(`2xx ${name} → 502 LIA_INVALID_RESPONSE`, async () => {
      const baseUrl = await startStub(reply(200, body));
      await assert.rejects(
        createLiaClient({ baseUrl, timeoutMs: 1000 }).chat({ messages: MESSAGES }),
        isBadGateway('LIA_INVALID_RESPONSE'),
      );
    });
  }

  it('resposta mais lenta que timeoutMs → 502 LIA_UNAVAILABLE', async () => {
    const baseUrl = await startStub((req, res) => setTimeout(() => reply(200, { text: 'tarde' })(req, res), 500));
    await assert.rejects(
      createLiaClient({ baseUrl, timeoutMs: 50 }).chat({ messages: MESSAGES }),
      isBadGateway('LIA_UNAVAILABLE', { endpoint: '/v1/chat' }),
    );
  });

  it('serviço fora do ar → 502 LIA_UNAVAILABLE', async () => {
    const baseUrl = await closedBaseUrl();
    await assert.rejects(
      createLiaClient({ baseUrl, timeoutMs: 1000 }).chat({ messages: MESSAGES }),
      isBadGateway('LIA_UNAVAILABLE'),
    );
  });
});

describe('createLiaClient().embed', () => {
  it('envia { inputs } para /v1/embeddings e devolve os vetores na ordem', async () => {
    let received;
    const vectors = [[1, 0], [0, 1]];
    const baseUrl = await startStub((req, res) => {
      received = req;
      reply(200, { vectors, dimensions: 2 })(req, res);
    });
    assert.deepEqual(await createLiaClient({ baseUrl, timeoutMs: 1000 }).embed(['a', 'b']), vectors);
    assert.equal(received.url, '/v1/embeddings');
    assert.deepEqual(received.body, { inputs: ['a', 'b'] });
  });

  it('lista vazia → [] sem chamar o serviço', async () => {
    let calls = 0;
    const baseUrl = await startStub((req, res) => {
      calls++;
      reply(200, { vectors: [] })(req, res);
    });
    assert.deepEqual(await createLiaClient({ baseUrl, timeoutMs: 1000 }).embed([]), []);
    assert.equal(calls, 0);
  });

  for (const [name, body] of [
    ['menos vetores que entradas', { vectors: [[1]] }],
    ['mais vetores que entradas', { vectors: [[1], [2], [3]] }],
    ['sem vectors', { dimensions: 2 }],
    ['item que não é array', { vectors: [[1], 'x'] }],
  ]) {
    it(`${name} → 502 LIA_INVALID_RESPONSE`, async () => {
      const baseUrl = await startStub(reply(200, body));
      await assert.rejects(
        createLiaClient({ baseUrl, timeoutMs: 1000 }).embed(['a', 'b']),
        isBadGateway('LIA_INVALID_RESPONSE', { endpoint: '/v1/embeddings' }),
      );
    });
  }

  it('500 → 502 LIA_ERROR', async () => {
    const baseUrl = await startStub(reply(500, { error: { code: 'internal_error' } }));
    await assert.rejects(
      createLiaClient({ baseUrl, timeoutMs: 1000 }).embed(['a']),
      isBadGateway('LIA_ERROR', { endpoint: '/v1/embeddings', status: 500, upstreamCode: 'internal_error' }),
    );
  });

  it('serviço fora do ar → 502 LIA_UNAVAILABLE', async () => {
    const baseUrl = await closedBaseUrl();
    await assert.rejects(
      createLiaClient({ baseUrl, timeoutMs: 1000 }).embed(['a']),
      isBadGateway('LIA_UNAVAILABLE', { endpoint: '/v1/embeddings' }),
    );
  });
});
