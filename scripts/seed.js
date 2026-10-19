import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { loadConfig } from '../src/config/env.js';
import { connectMongo, closeMongo } from '../src/integrations/mongo/client.js';
import { ensureIndexes } from '../src/integrations/mongo/indexes.js';

const DATA_DIR = join(import.meta.dirname, '..', 'data');

const requiredString = () =>
  z
    .string({ error: (issue) => (issue.input === undefined ? 'é obrigatório' : 'deve ser uma string') })
    .trim()
    .min(1, { error: 'não pode ser vazio' });

const list = (item) => z.array(item, { error: 'deve ser uma lista' });

const nonEmptyList = (item) => list(item).min(1, { error: 'deve ter ao menos 1 item' });

const uniqueBy = (keyOf, label) => (items, ctx) => {
  const seen = new Set();
  items.forEach((item, index) => {
    const key = keyOf(item);
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index, label], message: `duplicado: "${key}"` });
    seen.add(key);
  });
};

const companiesSchema = nonEmptyList(z.looseObject({ key: requiredString(), name: requiredString() })).superRefine(
  uniqueBy((company) => company.key, 'key'),
);

const integer = () =>
  z
    .number({ error: (issue) => (issue.input === undefined ? 'é obrigatório' : 'deve ser um número inteiro') })
    .int({ error: 'deve ser um número inteiro' });

const fieldsSchema = nonEmptyList(
  z.looseObject({
    companyKey: requiredString(),
    key: requiredString(),
    order: integer(),
    label: requiredString(),
    type: requiredString(),
    required: z.boolean({ error: 'deve ser true ou false' }).optional(),
    options: list(z.looseObject({ value: requiredString(), label: requiredString() })).optional(),
    attached: list(z.looseObject({ key: requiredString(), values: list(requiredString()) })).optional(),
  }),
).superRefine(uniqueBy((field) => `${field.companyKey}/${field.key}`, 'key'));

function parseOrThrow(schema, data, label) {
  const result = schema.safeParse(data);
  if (!result.success) throwInvalid(label, result.error.issues);
  return result.data;
}

function throwInvalid(label, issues) {
  const lines = issues.map((issue) => `- ${formatPath(issue.path)}: ${issue.message}`);
  throw new Error(`${label} inválido:\n${lines.join('\n')}`);
}

const queriesSchema = z.record(
  z.string(),
  list(
    z.preprocess(
      (query) => (typeof query === 'string' ? { text: query } : query),
      z.looseObject(
        { text: requiredString(), topK: integer().min(1, { error: 'deve ser maior ou igual a 1' }).optional() },
        { error: 'deve ser uma string ou um objeto { text, topK }' },
      ),
    ),
  ),
  { error: 'deve ser um objeto { companyKey: [frases] }' },
);

async function assertCompaniesExist(db, refs, label) {
  const known = new Set(await db.collection('companies').distinct('key'));
  const issues = refs
    .filter(({ companyKey }) => !known.has(companyKey))
    .map(({ companyKey, path }) => ({ path, message: `empresa não encontrada: "${companyKey}"` }));
  if (issues.length > 0) throwInvalid(label, issues);
}

function formatPath(path) {
  if (path.length === 0) return '(raiz)';
  return path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${part}`)).join('').replace(/^\./, '');
}

export async function readJsonFile(path) {
  let content;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Arquivo não encontrado: ${path}`, { cause: error });
    throw error;
  }

  try {
    return JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`JSON inválido em ${path}: ${error.message}`, { cause: error });
  }
}

export async function seedCompanies(db, companies) {
  const parsed = parseOrThrow(companiesSchema, companies, 'companies.json');
  const updatedAt = new Date();

  const result = await db.collection('companies').bulkWrite(
    parsed.map((company) => ({
      replaceOne: { filter: { key: company.key }, replacement: { ...company, updatedAt }, upsert: true },
    })),
  );
  return { inserted: result.upsertedCount, updated: result.matchedCount };
}

export async function seedFields(db, fields) {
  const parsed = parseOrThrow(fieldsSchema, fields, 'fields.json');
  await assertCompaniesExist(
    db,
    parsed.map((field, index) => ({ companyKey: field.companyKey, path: [index, 'companyKey'] })),
    'fields.json',
  );

  const fieldsByCompany = Map.groupBy(parsed, (field) => field.companyKey);
  const result = await db.collection('fields').bulkWrite([
    ...parsed.map((field) => ({
      replaceOne: { filter: { companyKey: field.companyKey, key: field.key }, replacement: field, upsert: true },
    })),
    ...[...fieldsByCompany].map(([companyKey, companyFields]) => ({
      deleteMany: { filter: { companyKey, key: { $nin: companyFields.map((field) => field.key) } } },
    })),
  ]);
  return { inserted: result.upsertedCount, updated: result.matchedCount, removed: result.deletedCount };
}

export async function seedQueries(db, queriesByCompany) {
  const parsed = parseOrThrow(queriesSchema, queriesByCompany, 'queries.json');
  const entries = Object.entries(parsed);
  await assertCompaniesExist(
    db,
    entries.map(([companyKey]) => ({ companyKey, path: [companyKey] })),
    'queries.json',
  );

  const operations = entries.flatMap(([companyKey, queries]) => [
    { deleteMany: { filter: { companyKey } } },
    ...queries.map((query, position) => ({ insertOne: { document: { companyKey, ...query, position } } })),
  ]);
  if (operations.length > 0) await db.collection('queries').bulkWrite(operations);

  return { companies: entries.length, queries: entries.reduce((total, [, queries]) => total + queries.length, 0) };
}

export async function runSeed() {
  const config = loadConfig();
  const db = await connectMongo(config.mongoUri);
  try {
    await ensureIndexes(db);
    const [companies, fields, queries] = await Promise.all(
      ['companies.json', 'fields.json', 'queries.json'].map((file) => readJsonFile(join(DATA_DIR, file))),
    );

    const c = await seedCompanies(db, companies);
    console.log(`Empresas: ${c.inserted + c.updated} (${c.inserted} novas, ${c.updated} existentes)`);
    const f = await seedFields(db, fields);
    console.log(`Campos: ${f.inserted + f.updated} (${f.inserted} novos, ${f.updated} existentes, ${f.removed} removidos)`);
    const q = await seedQueries(db, queries);
    console.log(`Frases: ${q.queries} em ${q.companies} empresas`);
  } finally {
    await closeMongo();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runSeed().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
