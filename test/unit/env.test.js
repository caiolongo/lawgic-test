import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config/env.js';

const validEnv = {
  MONGO_URI: 'mongodb://localhost:27017/mini-lia',
  LIA_BASE_URL: 'http://localhost:4010',
};

const configError = (...fragments) => (error) => {
  assert.match(error.message, /^Configuração inválida:/);
  for (const fragment of fragments) assert.ok(error.message.includes(fragment), error.message);
  return true;
};

describe('loadConfig', () => {
  it('aplica os defaults quando só as obrigatórias estão definidas', () => {
    assert.deepEqual(loadConfig(validEnv), {
      port: 3000,
      mongoUri: 'mongodb://localhost:27017/mini-lia',
      lia: { baseUrl: 'http://localhost:4010', timeoutMs: 30000 },
      rag: { chunkSize: 1200, chunkOverlap: 200, defaultTopK: 2 },
      prompt: { maxChars: 16000 },
      upload: { maxBytes: 10485760 },
    });
  });

  it('converte os valores numéricos informados', () => {
    const config = loadConfig({
      ...validEnv,
      PORT: '8080',
      LIA_TIMEOUT_MS: '5000',
      RAG_CHUNK_SIZE: '1000',
      RAG_CHUNK_OVERLAP: '150',
      RAG_DEFAULT_TOP_K: '3',
      PROMPT_MAX_CHARS: '12000',
      UPLOAD_MAX_BYTES: '2048',
    });

    assert.equal(config.port, 8080);
    assert.equal(config.lia.timeoutMs, 5000);
    assert.deepEqual(config.rag, { chunkSize: 1000, chunkOverlap: 150, defaultTopK: 3 });
    assert.equal(config.prompt.maxChars, 12000);
    assert.equal(config.upload.maxBytes, 2048);
  });

  it('aceita mongodb+srv://', () => {
    const config = loadConfig({ ...validEnv, MONGO_URI: 'mongodb+srv://user:pass@cluster.example.net/mini-lia' });
    assert.equal(config.mongoUri, 'mongodb+srv://user:pass@cluster.example.net/mini-lia');
  });

  it('remove barras finais da URL da LIA', () => {
    assert.equal(loadConfig({ ...validEnv, LIA_BASE_URL: 'http://lia-mock:4010//' }).lia.baseUrl, 'http://lia-mock:4010');
  });

  it('trata variável vazia ou só com espaços como ausente', () => {
    assert.equal(loadConfig({ ...validEnv, PORT: '' }).port, 3000);
    assert.equal(loadConfig({ ...validEnv, PORT: '   ' }).port, 3000);
    assert.throws(() => loadConfig({ ...validEnv, MONGO_URI: '' }), configError('MONGO_URI: é obrigatória'));
  });

  it('exige MONGO_URI e LIA_BASE_URL', () => {
    assert.throws(() => loadConfig({}), configError('MONGO_URI: é obrigatória', 'LIA_BASE_URL: é obrigatória'));
  });

  for (const port of ['abc', '3000.5', '0', '70000', '-1']) {
    it(`rejeita PORT=${port}`, () => {
      assert.throws(() => loadConfig({ ...validEnv, PORT: port }), configError('PORT:'));
    });
  }

  it('rejeita MONGO_URI sem o esquema mongodb', () => {
    assert.throws(
      () => loadConfig({ ...validEnv, MONGO_URI: 'localhost:27017/mini-lia' }),
      configError('MONGO_URI: deve começar com mongodb://'),
    );
  });

  for (const uri of ['mongodb://h1:27017,h2:27017/mini-lia?replicaSet=rs0', 'mongodb://127.0.0.1:51234/']) {
    it(`aceita MONGO_URI ${uri}`, () => {
      assert.equal(loadConfig({ ...validEnv, MONGO_URI: uri }).mongoUri, uri);
    });
  }

  for (const url of ['localhost:4010', 'ftp://lia:4010', 'não é url']) {
    it(`rejeita LIA_BASE_URL=${url}`, () => {
      assert.throws(
        () => loadConfig({ ...validEnv, LIA_BASE_URL: url }),
        configError('LIA_BASE_URL: deve ser uma URL http(s) válida'),
      );
    });
  }

  it('rejeita overlap maior ou igual ao tamanho do chunk', () => {
    for (const overlap of ['1200', '1500']) {
      assert.throws(
        () => loadConfig({ ...validEnv, RAG_CHUNK_SIZE: '1200', RAG_CHUNK_OVERLAP: overlap }),
        configError('RAG_CHUNK_OVERLAP: deve ser menor que RAG_CHUNK_SIZE'),
      );
    }
  });

  it('rejeita overlap zero e topK zero', () => {
    assert.throws(
      () => loadConfig({ ...validEnv, RAG_CHUNK_OVERLAP: '0', RAG_DEFAULT_TOP_K: '0' }),
      configError('RAG_CHUNK_OVERLAP: deve ser maior ou igual a 1', 'RAG_DEFAULT_TOP_K: deve ser maior ou igual a 1'),
    );
  });

  it('reporta todos os erros de uma vez', () => {
    assert.throws(
      () => loadConfig({ PORT: 'abc', LIA_BASE_URL: 'x', RAG_CHUNK_SIZE: '100', RAG_CHUNK_OVERLAP: '100' }),
      configError('PORT:', 'MONGO_URI: é obrigatória', 'LIA_BASE_URL:', 'RAG_CHUNK_OVERLAP: deve ser menor que RAG_CHUNK_SIZE'),
    );
  });

  it('ignora variáveis desconhecidas e não altera o env recebido', () => {
    const env = { ...validEnv, PATH: '/usr/bin', LIA_BASE_URL: 'http://localhost:4010/' };
    const snapshot = { ...env };

    const config = loadConfig(env);

    assert.deepEqual(env, snapshot);
    assert.equal('PATH' in config, false);
  });

  it('devolve a configuração congelada em todos os níveis', () => {
    const config = loadConfig(validEnv);
    assert.ok(Object.isFrozen(config));
    for (const section of ['lia', 'rag', 'prompt', 'upload']) assert.ok(Object.isFrozen(config[section]), section);
  });
});
