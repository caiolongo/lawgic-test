import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { notFoundHandler, errorHandler } from '../../src/middlewares/error-handler.js';
import { NotFoundError, BadRequestError, BadGatewayError } from '../../src/errors/http-errors.js';

function buildApp(defineRoutes = () => {}) {
  const logger = { error: mock.fn() };
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  defineRoutes(app);
  app.use(notFoundHandler());
  app.use(errorHandler({ logger }));
  return { app, logger };
}

describe('notFoundHandler', () => {
  it('responde 404 em JSON sem ecoar a query string', async () => {
    const { app, logger } = buildApp();

    const res = await request(app).get('/nao-existe?token=secreto').expect(404).expect('Content-Type', /json/);

    assert.deepEqual(res.body, { error: { code: 'ROUTE_NOT_FOUND', message: 'Rota não encontrada: GET /nao-existe' } });
    assert.equal(res.text.includes('secreto'), false);
    assert.equal(logger.error.mock.callCount(), 0);
  });

  it('responde 404 para método não suportado em rota existente', async () => {
    const { app } = buildApp((app) => app.get('/ok', (req, res) => res.json({ ok: true })));

    const res = await request(app).delete('/ok').expect(404);

    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  });
});

describe('errorHandler', () => {
  it('converte HttpError com details no formato padrão', async () => {
    const { app } = buildApp((app) =>
      app.get('/x', () => {
        throw new NotFoundError('Empresa não encontrada', { code: 'COMPANY_NOT_FOUND', details: { companyKey: 'x' } });
      }),
    );

    const res = await request(app).get('/x').expect(404).expect('Content-Type', /json/);

    assert.deepEqual(res.body, {
      error: { code: 'COMPANY_NOT_FOUND', message: 'Empresa não encontrada', details: { companyKey: 'x' } },
    });
  });

  it('omite details quando não há', async () => {
    const { app } = buildApp((app) =>
      app.get('/x', () => {
        throw new NotFoundError();
      }),
    );

    const res = await request(app).get('/x').expect(404);

    assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: 'Recurso não encontrado' } });
  });

  it('trata rejeição de handler async', async () => {
    const { app, logger } = buildApp((app) =>
      app.get('/x', async () => {
        throw new BadRequestError('Arquivo ausente', { code: 'FILE_REQUIRED' });
      }),
    );

    const res = await request(app).get('/x').expect(400);

    assert.deepEqual(res.body, { error: { code: 'FILE_REQUIRED', message: 'Arquivo ausente' } });
    assert.equal(logger.error.mock.callCount(), 0);
  });

  it('registra 5xx com a causa no log, sem expô-la na resposta', async () => {
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:4010');
    const thrown = new BadGatewayError('Falha ao consultar a LIA', { cause });
    const { app, logger } = buildApp((app) =>
      app.get('/x', async () => {
        throw thrown;
      }),
    );

    const res = await request(app).get('/x').expect(502);

    assert.deepEqual(res.body, { error: { code: 'BAD_GATEWAY', message: 'Falha ao consultar a LIA' } });
    assert.equal(res.text.includes('ECONNREFUSED'), false);
    assert.equal(logger.error.mock.callCount(), 1);
    const [message, logged] = logger.error.mock.calls[0].arguments;
    assert.equal(message, 'GET /x → 502');
    assert.equal(logged, thrown);
    assert.equal(logged.cause, cause);
  });

  it('responde 400 INVALID_JSON para JSON malformado, sem a mensagem do parser', async () => {
    const { app, logger } = buildApp((app) => app.post('/echo', (req, res) => res.json(req.body)));

    const res = await request(app).post('/echo').set('Content-Type', 'application/json').send('{"a":').expect(400);

    assert.deepEqual(res.body, { error: { code: 'INVALID_JSON', message: 'JSON malformado no corpo da requisição' } });
    assert.equal(/Unexpected|position|JSON\.parse/.test(res.text), false);
    assert.equal(logger.error.mock.callCount(), 0);
  });

  it('responde 413 para corpo JSON acima do limite', async () => {
    const { app } = buildApp((app) => app.post('/echo', (req, res) => res.json(req.body)));

    const res = await request(app).post('/echo').send({ data: 'x'.repeat(2048) }).expect(413);

    assert.deepEqual(res.body, {
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Conteúdo excede o tamanho máximo permitido' },
    });
  });

  it('preserva o status de outros erros 4xx do Express com mensagem própria', async () => {
    const { app } = buildApp((app) => app.post('/echo', (req, res) => res.json(req.body)));

    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json; charset=iso-8859-1')
      .send('{}')
      .expect(415);

    assert.deepEqual(res.body, { error: { code: 'BAD_REQUEST', message: 'Requisição inválida' } });
  });

  it('responde 500 genérico sem vazar mensagem nem stack, e registra o erro', async () => {
    const thrown = new Error('senha do banco: hunter2');
    const { app, logger } = buildApp((app) =>
      app.get('/x', () => {
        throw thrown;
      }),
    );

    const res = await request(app).get('/x').expect(500).expect('Content-Type', /json/);

    assert.deepEqual(res.body, { error: { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' } });
    assert.equal(/hunter2|\bat\b.*\.js/.test(res.text), false);
    assert.equal(logger.error.mock.callCount(), 1);
    assert.equal(logger.error.mock.calls[0].arguments[1], thrown);
  });

  it('responde 500 quando o valor lançado não é um Error', async () => {
    const { app, logger } = buildApp((app) => {
      app.get('/string', () => {
        throw 'falhou';
      });
      app.get('/next', (req, res, next) => next('falhou'));
    });

    for (const path of ['/string', '/next']) {
      const res = await request(app).get(path).expect(500);
      assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    }
    assert.equal(logger.error.mock.callCount(), 2);
  });

  it('delega ao Express quando a resposta já começou', () => {
    const err = new Error('tarde demais');
    const res = { headersSent: true, status: mock.fn(), json: mock.fn() };
    const next = mock.fn();

    errorHandler({ logger: { error: mock.fn() } })(err, { method: 'GET', path: '/x' }, res, next);

    assert.equal(next.mock.callCount(), 1);
    assert.equal(next.mock.calls[0].arguments[0], err);
    assert.equal(res.status.mock.callCount(), 0);
    assert.equal(res.json.mock.callCount(), 0);
  });
});
