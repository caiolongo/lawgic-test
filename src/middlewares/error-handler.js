import { HttpError, BadRequestError, PayloadTooLargeError } from '../errors/http-errors.js';

const INTERNAL_ERROR = { code: 'INTERNAL_ERROR', message: 'Erro interno do servidor' };

export function notFoundHandler() {
  return (req, res) => {
    res.status(404).json({
      error: { code: 'ROUTE_NOT_FOUND', message: `Rota não encontrada: ${req.method} ${req.path}` },
    });
  };
}

export function errorHandler({ logger = console } = {}) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);

    const httpError = toHttpError(err);
    const status = httpError?.status ?? 500;

    if (status >= 500) logger.error(`${req.method} ${req.path} → ${status}`, err);

    res.status(status).json({ error: httpError ? toBody(httpError) : INTERNAL_ERROR });
  };
}

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  if (err?.type === 'entity.parse.failed') {
    return new BadRequestError('JSON malformado no corpo da requisição', { code: 'INVALID_JSON', cause: err });
  }
  if (err?.type === 'entity.too.large') return new PayloadTooLargeError(undefined, { cause: err });
  if (err?.expose === true && Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    return new HttpError(err.status, 'Requisição inválida', { code: 'BAD_REQUEST', cause: err });
  }
  return null;
}

function toBody({ code, message, details }) {
  return details === undefined ? { code, message } : { code, message, details };
}
