import multer from 'multer';
import { BadRequestError, PayloadTooLargeError } from '../errors/http-errors.js';

const PDF_SIGNATURE = Buffer.from('%PDF-');
const SIGNATURE_WINDOW_BYTES = 1024;

export function pdfUpload({ maxBytes }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    defParamCharset: 'utf8',
  }).single('file');

  return (req, res, next) => {
    upload(req, res, (err) => next(err && toUploadError(err, maxBytes)));
  };
}

// Também cobre erros de parse do busboy (multipart malformado), que não são MulterError.
function toUploadError(err, maxBytes) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new PayloadTooLargeError('O arquivo excede o tamanho máximo permitido', {
      code: 'FILE_TOO_LARGE',
      details: { maxBytes },
      cause: err,
    });
  }
  return new BadRequestError('Upload inválido: envie um único PDF no campo "file" (multipart/form-data)', {
    code: 'INVALID_UPLOAD',
    cause: err,
  });
}

export function assertPdfFile(file) {
  if (!file) {
    throw new BadRequestError('Envie o PDF no campo "file" (multipart/form-data)', { code: 'FILE_REQUIRED' });
  }
  if (!file.buffer.subarray(0, SIGNATURE_WINDOW_BYTES).includes(PDF_SIGNATURE)) {
    throw new BadRequestError('O arquivo enviado não é um PDF', { code: 'INVALID_PDF' });
  }
}
