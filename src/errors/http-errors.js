export class HttpError extends Error {
  constructor(status, message, { code = 'HTTP_ERROR', details, cause } = {}) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new TypeError(`Status HTTP de erro inválido: ${status}`);
    }
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Requisição inválida', options = {}) {
    super(400, message, { ...options, code: options.code ?? 'BAD_REQUEST' });
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Recurso não encontrado', options = {}) {
    super(404, message, { ...options, code: options.code ?? 'NOT_FOUND' });
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message = 'Conteúdo excede o tamanho máximo permitido', options = {}) {
    super(413, message, { ...options, code: options.code ?? 'PAYLOAD_TOO_LARGE' });
  }
}

export class BadGatewayError extends HttpError {
  constructor(message = 'Falha ao comunicar com um serviço externo', options = {}) {
    super(502, message, { ...options, code: options.code ?? 'BAD_GATEWAY' });
  }
}
