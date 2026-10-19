import { z } from 'zod';

const integer = ({ min = 1, max } = {}) => {
  const schema = z.coerce
    .number({ error: 'deve ser um número inteiro' })
    .int({ error: 'deve ser um número inteiro' })
    .min(min, { error: `deve ser maior ou igual a ${min}` });
  return max === undefined ? schema : schema.max(max, { error: `deve ser menor ou igual a ${max}` });
};

const requiredOr = (message) => ({
  error: (issue) => (issue.input === undefined ? 'é obrigatória' : message),
});

const fields = {
  PORT: integer({ max: 65535 }).default(3000),
  MONGO_URI: z
    .string(requiredOr('deve ser uma string'))
    .regex(/^mongodb(\+srv)?:\/\/\S+$/, { error: 'deve começar com mongodb:// ou mongodb+srv://' }),
  LIA_BASE_URL: z
    .url({ protocol: /^https?$/, ...requiredOr('deve ser uma URL http(s) válida') })
    .transform((url) => url.replace(/\/+$/, '')),
  LIA_TIMEOUT_MS: integer().default(30000),
  RAG_CHUNK_SIZE: integer().default(1200),
  RAG_CHUNK_OVERLAP: integer().default(200),
  RAG_DEFAULT_TOP_K: integer().default(2),
  PROMPT_MAX_CHARS: integer().default(16000),
  UPLOAD_MAX_BYTES: integer().default(10 * 1024 * 1024),
};

const chunkFields = z.object({
  RAG_CHUNK_SIZE: fields.RAG_CHUNK_SIZE,
  RAG_CHUNK_OVERLAP: fields.RAG_CHUNK_OVERLAP,
});

// Sem `when`, o zod 4 pula o refine do objeto quando qualquer outro campo falha.
const envSchema = z.object(fields).refine((env) => env.RAG_CHUNK_OVERLAP < env.RAG_CHUNK_SIZE, {
  path: ['RAG_CHUNK_OVERLAP'],
  error: 'deve ser menor que RAG_CHUNK_SIZE',
  when: ({ value }) => chunkFields.safeParse(value).success,
});

const KEYS = Object.keys(fields);

export function loadConfig(env = process.env) {
  const raw = Object.fromEntries(KEYS.map((key) => [key, env[key]?.trim() || undefined]));
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const lines = result.error.issues.map((issue) => `- ${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Configuração inválida:\n${lines.join('\n')}`);
  }

  const e = result.data;
  return Object.freeze({
    port: e.PORT,
    mongoUri: e.MONGO_URI,
    lia: Object.freeze({ baseUrl: e.LIA_BASE_URL, timeoutMs: e.LIA_TIMEOUT_MS }),
    rag: Object.freeze({
      chunkSize: e.RAG_CHUNK_SIZE,
      chunkOverlap: e.RAG_CHUNK_OVERLAP,
      defaultTopK: e.RAG_DEFAULT_TOP_K,
    }),
    prompt: Object.freeze({ maxChars: e.PROMPT_MAX_CHARS }),
    upload: Object.freeze({ maxBytes: e.UPLOAD_MAX_BYTES }),
  });
}
