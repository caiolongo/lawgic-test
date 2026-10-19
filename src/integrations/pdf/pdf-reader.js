import { PDFParse } from 'pdf-parse';
import { BadRequestError } from '../../errors/http-errors.js';

export async function readPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text, pages: result.total };
  } catch (error) {
    throw new BadRequestError('Não foi possível ler o PDF', { code: 'INVALID_PDF', cause: error });
  } finally {
    await parser.destroy();
  }
}
