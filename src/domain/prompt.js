const SYSTEM = [
  'Você extrai dados de documentos jurídicos.',
  'Responda somente com um objeto JSON cujas chaves são exatamente as keys dos campos listados.',
  'Em campos com opções, responda o value da opção.',
  'Em datas, use AAAA-MM-DD.',
  'Se o documento não trouxer o valor, responda null.',
].join(' ');

const SEPARATOR = '---';

function describeField({ key, type, label, options }) {
  const line = `- ${key} (${type}): ${label}`;
  if (!Array.isArray(options) || options.length === 0) return line;
  return `${line} — opções: ${options.map((option) => `${option.value} (${option.label})`).join(', ')}`;
}

export function buildPrompt(fields, excerpts) {
  const document =
    excerpts.length === 0
      ? '(nenhum trecho)'
      : [SEPARATOR, ...excerpts.flatMap((excerpt) => [excerpt, SEPARATOR])].join('\n');

  const content = ['Campos:', ...fields.map(describeField), '', 'Trechos do documento:', document].join('\n');
  return { system: SYSTEM, messages: [{ role: 'user', content }] };
}

// Mesma fórmula do LIA Mock para o limite de caracteres.
export function promptLength({ system, messages }) {
  return [system || '', ...messages.map((message) => message.content)].join('\n\n').length;
}

export function fitToBudget(fields, chunks, maxChars) {
  const removalOrder = [...chunks].sort((a, b) => a.score - b.score || b.index - a.index);
  let kept = chunks;
  let prompt = buildPrompt(fields, kept.map((chunk) => chunk.text));

  for (const removed of removalOrder) {
    if (promptLength(prompt) <= maxChars) break;
    kept = kept.filter((chunk) => chunk !== removed);
    prompt = buildPrompt(fields, kept.map((chunk) => chunk.text));
  }
  return { prompt, chunks: kept };
}
