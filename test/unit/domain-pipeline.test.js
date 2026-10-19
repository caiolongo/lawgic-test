import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractJson } from '../../src/domain/ai-response.js';
import { sanitizeAiOutput } from '../../src/domain/field-values.js';
import { buildForm } from '../../src/domain/visibility.js';
import { README_EXPECTED } from '../fixtures/readme-expected.js';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const fields = readJson('../../data/fields.json');
const evidence = readJson('../../lia-mock/evidence/public.json');

const mockChatText = (result) =>
  'Claro! Analisei o documento e segue o resultado da extração:\n\n```json\n' +
  JSON.stringify(result, null, 2) +
  '\n```\n\nSe precisar de mais alguma informação, é só pedir.';

describe('pipeline do domínio com as respostas reais do mock', () => {
  for (const [doc, expected] of Object.entries(README_EXPECTED)) {
    it(`${expected.companyKey} + ${doc}: texto do mock → formData do README`, () => {
      const answers = Object.fromEntries(
        evidence.entries.filter((entry) => entry.doc === doc).map((entry) => [entry.key, entry.answer]),
      );
      const companyFields = fields.filter((field) => field.companyKey === expected.companyKey);

      const raw = extractJson(mockChatText(answers));
      const form = buildForm(companyFields, sanitizeAiOutput(companyFields, raw));

      assert.deepEqual(form, { formData: expected.formData, missingRequired: expected.missingRequired });
    });
  }
});
