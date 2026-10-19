import { BadGatewayError } from '../../errors/http-errors.js';

const fail = (code, details, cause) => new BadGatewayError('Falha na chamada à IA', { code, details, cause });

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createLiaClient({ baseUrl, timeoutMs }) {
  async function post(endpoint, payload) {
    let response;
    let raw;
    try {
      response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = await response.text();
    } catch (error) {
      throw fail('LIA_UNAVAILABLE', { endpoint }, error);
    }

    const data = parseJson(raw);
    if (!response.ok) {
      throw fail('LIA_ERROR', { endpoint, status: response.status, upstreamCode: data?.error?.code });
    }
    if (data === undefined) {
      throw fail('LIA_INVALID_RESPONSE', { endpoint });
    }
    return data;
  }

  async function chat({ system, messages }) {
    const endpoint = '/v1/chat';
    const data = await post(endpoint, { system, messages });
    if (typeof data?.text !== 'string') {
      throw fail('LIA_INVALID_RESPONSE', { endpoint });
    }
    return data.text;
  }

  async function embed(inputs) {
    // O mock responde 400 para lista vazia.
    if (inputs.length === 0) return [];

    const endpoint = '/v1/embeddings';
    const data = await post(endpoint, { inputs });
    const vectors = data?.vectors;
    if (!Array.isArray(vectors) || vectors.length !== inputs.length || !vectors.every(Array.isArray)) {
      throw fail('LIA_INVALID_RESPONSE', { endpoint });
    }
    return vectors;
  }

  return { chat, embed };
}
