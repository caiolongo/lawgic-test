import { BadGatewayError, NotFoundError } from '../errors/http-errors.js';
import { assertPdfFile } from '../middlewares/pdf-upload.js';
import { readPdf } from '../integrations/pdf/pdf-reader.js';
import { findQueriesByCompany } from '../integrations/mongo/queries.repository.js';
import { insertExtraction, findExtractionById } from '../integrations/mongo/extractions.repository.js';
import { buildPrompt, fitToBudget } from '../domain/prompt.js';
import { extractJson } from '../domain/ai-response.js';
import { isKnownFieldType, sanitizeAiOutput } from '../domain/field-values.js';
import { buildForm } from '../domain/visibility.js';
import { getCompanyFields } from './company.service.js';
import { retrieveContext } from './retrieval.service.js';

const FULL_CONTENT_MAX_PAGES = 5;

export async function createExtraction(companyKey, file, { lia, rag, maxPromptChars, logger }) {
  const fields = await getCompanyFields(companyKey);
  assertPdfFile(file);
  const { text, pages } = await readPdf(file.buffer);

  const { strategy, prompt, usedChunks } =
    pages <= FULL_CONTENT_MAX_PAGES
      ? { strategy: 'fullContent', prompt: buildPrompt(fields, [text]), usedChunks: 0 }
      : await buildChunkedPrompt(companyKey, fields, text, { lia, rag, maxPromptChars });

  const raw = extractJson(await lia.chat(prompt));
  if (raw === null) {
    throw new BadGatewayError('Falha na chamada à IA', { code: 'LIA_INVALID_RESPONSE' });
  }

  const unknownTypes = fields.filter((field) => !isKnownFieldType(field.type)).map((field) => field.key);
  if (unknownTypes.length > 0) {
    logger.warn(`Campos com type sem parser, tratados como text (${companyKey}): ${unknownTypes.join(', ')}`);
  }

  const { formData, missingRequired } = buildForm(fields, sanitizeAiOutput(fields, raw));
  const saved = await insertExtraction({
    companyKey,
    strategy,
    usedChunks,
    formData,
    missingRequired,
    file: { name: file.originalname, size: file.size, pages },
    createdAt: new Date(),
  });
  return toExtractionResponse(saved);
}

async function buildChunkedPrompt(companyKey, fields, text, { lia, rag, maxPromptChars }) {
  const queries = await findQueriesByCompany(companyKey);
  const selected = await retrieveContext(text, queries, { lia, rag });
  const { prompt, chunks } = fitToBudget(fields, selected, maxPromptChars);
  return { strategy: 'chunked', prompt, usedChunks: chunks.length };
}

export async function getExtraction(id) {
  const extraction = await findExtractionById(id);
  if (!extraction) {
    throw new NotFoundError('Extração não encontrada', { code: 'EXTRACTION_NOT_FOUND', details: { id } });
  }
  return toExtractionResponse(extraction);
}

export function toExtractionResponse({ _id, companyKey, strategy, usedChunks, formData, missingRequired, createdAt }) {
  return { id: _id.toString(), companyKey, strategy, usedChunks, formData, missingRequired, createdAt };
}
