import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  BadRequestError,
  NotFoundError,
  PayloadTooLargeError,
  BadGatewayError,
} from '../../src/errors/http-errors.js';

const subclasses = [
  { Class: BadRequestError, status: 400, code: 'BAD_REQUEST', message: 'Requisição inválida' },
  { Class: NotFoundError, status: 404, code: 'NOT_FOUND', message: 'Recurso não encontrado' },
  { Class: PayloadTooLargeError, status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Conteúdo excede o tamanho máximo permitido' },
  { Class: BadGatewayError, status: 502, code: 'BAD_GATEWAY', message: 'Falha ao comunicar com um serviço externo' },
];

describe('HttpError', () => {
  it('guarda status, code, message e details', () => {
    const error = new HttpError(409, 'Conflito', { code: 'CONFLICT', details: { key: 'acme' } });

    assert.equal(error.status, 409);
    assert.equal(error.code, 'CONFLICT');
    assert.equal(error.message, 'Conflito');
    assert.deepEqual(error.details, { key: 'acme' });
    assert.equal(error.name, 'HttpError');
    assert.ok(error instanceof Error);
  });

  it('usa HTTP_ERROR como code padrão e deixa details indefinido', () => {
    const error = new HttpError(418, 'Bule');
    assert.equal(error.code, 'HTTP_ERROR');
    assert.equal(error.details, undefined);
  });

  it('preserva a causa original só quando informada', () => {
    const cause = new Error('ECONNREFUSED');
    assert.equal(new HttpError(502, 'Falha', { cause }).cause, cause);
    assert.equal('cause' in new HttpError(502, 'Falha'), false);
  });

  for (const status of [200, 399, 600, 404.5, '404', undefined]) {
    it(`rejeita status ${String(status)}`, () => {
      assert.throws(() => new HttpError(status, 'x'), TypeError);
    });
  }

  it('gera stack trace com o nome da classe', () => {
    assert.match(new NotFoundError().stack, /^NotFoundError: Recurso não encontrado/);
  });
});

for (const { Class, status, code, message } of subclasses) {
  describe(Class.name, () => {
    it('aplica status, code e mensagem padrão', () => {
      const error = new Class();
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.message, message);
      assert.equal(error.name, Class.name);
    });

    it('aceita mensagem, code, details e cause próprios', () => {
      const cause = new Error('origem');
      const error = new Class('Mensagem própria', { code: 'CUSTOM', details: { field: 'file' }, cause });

      assert.equal(error.status, status);
      assert.equal(error.message, 'Mensagem própria');
      assert.equal(error.code, 'CUSTOM');
      assert.deepEqual(error.details, { field: 'file' });
      assert.equal(error.cause, cause);
    });

    it('mantém o code padrão quando code vem undefined', () => {
      assert.equal(new Class('x', { code: undefined }).code, code);
    });

    it('é instância de HttpError e de Error', () => {
      const error = new Class();
      assert.ok(error instanceof Class);
      assert.ok(error instanceof HttpError);
      assert.ok(error instanceof Error);
    });
  });
}
