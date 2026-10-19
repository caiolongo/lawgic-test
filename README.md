# Mini-LIA

API em Node.js + MongoDB que recebe o PDF de um processo, pede à IA (LIA Mock) os campos do formulário da empresa,
limpa a resposta, aplica as regras de exibição e devolve o formulário pronto.

O enunciado original do teste está em [`ENUNCIADO.md`](ENUNCIADO.md).

- [Rodando com Docker](#rodando-com-docker-recomendado)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Testes](#testes)
- [Endpoints](#endpoints)
- [Como funciona](#como-funciona)
- [Arquitetura](#arquitetura)
- [Decisões](#decisões)
- [Limitações conhecidas](#limitações-conhecidas)
- [O que eu faria com mais tempo](#o-que-eu-faria-com-mais-tempo)

---

## Rodando com Docker

Pré-requisito: Docker com Docker Compose. Não precisa de `.env` nem de Node instalado.

```bash
git clone https://github.com/caiolongo/lawgic-test.git
cd lawgic-test
docker compose up --build
```

Isso sobe três serviços: **MongoDB** (`localhost:27017`), **LIA Mock** (`localhost:4010`) e a **API** (`localhost:3000`).
Antes de a API subir, o seed carrega `data/` no Mongo automaticamente. O log mostra:

```
api-1  | Empresas: 2 (2 novas, 0 existentes)
api-1  | Campos: 25 (25 novos, 0 existentes, 0 removidos)
api-1  | Frases: 16 em 2 empresas
api-1  | Mini-LIA ouvindo na porta 3000
```

Em outro terminal, as duas extrações do enunciado:

```bash
curl -F "file=@data/documents/processo-curto.pdf" http://localhost:3000/companies/acme-edu/extractions
curl -F "file=@data/documents/processo-longo.pdf" http://localhost:3000/companies/rodovia-sul/extractions
```

Para começar do zero (apaga o banco): `docker compose down -v && docker compose up --build`.

A pasta `data/` é montada no container (somente leitura). Uma empresa nova adicionada em `data/` entra com
`docker compose up`, sem rebuild: o seed roda a cada subida e não duplica nada.

## Variáveis de ambiente

São validadas na partida: valor faltando ou inválido derruba a API com uma mensagem dizendo qual variável corrigir.

| Variável | Obrigatória | Padrão | O que é |
|---|---|---|---|
| `MONGO_URI` | sim | — | Conexão com o MongoDB. Use o nome do banco no fim (`.../mini-lia`); sem ele, API e seed usam o banco padrão do driver |
| `LIA_BASE_URL` | sim | — | Endereço do LIA Mock (`http://localhost:4010`; dentro do compose, `http://lia-mock:4010`) |
| `PORT` | não | `3000` | Porta da API |
| `LIA_TIMEOUT_MS` | não | `30000` | Tempo máximo de cada chamada à IA; acima disso, 502 |
| `RAG_CHUNK_SIZE` | não | `1200` | Tamanho dos trechos do RAG, em caracteres |
| `RAG_CHUNK_OVERLAP` | não | `200` | Sobreposição entre trechos vizinhos (precisa ser menor que `RAG_CHUNK_SIZE`) |
| `RAG_DEFAULT_TOP_K` | não | `2` | Trechos escolhidos por frase de busca, quando a frase não define o próprio `topK` |
| `PROMPT_MAX_CHARS` | não | `16000` | Limite do prompt (o mesmo do LIA Mock) |
| `UPLOAD_MAX_BYTES` | não | `10485760` | Tamanho máximo do PDF (10 MB); acima disso, 413 |

No Docker, o `docker-compose.yml` define `MONGO_URI` e `LIA_BASE_URL`; o `.env` não é usado.

## Testes

```bash
docker compose up -d mongo   # os testes de integração usam o Mongo em localhost:27017
npm test
```

384 testes com o runner nativo do Node (`node:test`) e `supertest`. Não precisam do LIA Mock: os testes de pipeline e de
rota usam a lógica do próprio mock (`lia-mock/src/chat.js` e `embeddings.js`) dentro do processo ou num servidor de
teste. Cada arquivo usa um banco próprio (`mini-lia-test-*`), porque o `node:test` roda os arquivos em paralelo.

## Endpoints

| Método e rota | Sucesso | Erros |
|---|---|---|
| `GET /companies/:companyKey/fields` | `200` campos ordenados por `order`, no formato de `fields.json` | `404` |
| `POST /companies/:companyKey/extractions` (PDF em `multipart/form-data`, campo `file`) | `201` `{ id, companyKey, strategy, usedChunks, formData, missingRequired, createdAt }` | `400`, `404`, `413`, `502` |
| `GET /extractions/:id` | `200`, mesmo formato do POST | `404` |
| `GET /health` | `200` `{ status: "ok" }` | — |

Todo erro sai no mesmo formato: `{ "error": { "code": "...", "message": "...", "details": { ... } } }`.

| Status | `code` | Quando |
|---|---|---|
| 400 | `FILE_REQUIRED` | sem arquivo (inclusive corpo que não é multipart) |
| 400 | `INVALID_PDF` | não começa com `%PDF-` nos primeiros 1024 bytes, ou o PDF não abre |
| 400 | `INVALID_UPLOAD` | arquivo em outro campo, mais de um arquivo, multipart malformado |
| 404 | `COMPANY_NOT_FOUND` / `EXTRACTION_NOT_FOUND` | empresa ou extração inexistente (id mal formado também é 404) |
| 413 | `FILE_TOO_LARGE` | acima de `UPLOAD_MAX_BYTES` |
| 502 | `LIA_UNAVAILABLE` | IA fora do ar ou timeout |
| 502 | `LIA_ERROR` | IA respondeu erro (inclusive o 413 de prompt grande demais); `details` traz `status` e o `code` da IA |
| 502 | `LIA_INVALID_RESPONSE` | resposta da IA sem `text`, sem objeto JSON ou com nº de vetores errado |

## Como funciona

O `POST /companies/:companyKey/extractions`, passo a passo (`src/services/extraction.service.js`):

1. **Empresa e campos** vêm do Mongo. Empresa inexistente → 404, antes de olhar o arquivo.
2. **Arquivo**: precisa existir e começar com `%PDF-`; o mimetype enviado pelo cliente é ignorado.
3. **Leitura do PDF** com `pdf-parse`: texto e número de páginas.
4. **Estratégia**:
   - até 5 páginas → `fullContent`: o texto vai inteiro para a IA;
   - mais de 5 → `chunked` (RAG): o texto é dividido em trechos de 1.200 caracteres com 200 de sobreposição; trechos e
     frases de busca da empresa vão numa única chamada ao `/v1/embeddings`; para cada frase, os `topK` trechos de maior
     similaridade de cosseno; a união, sem repetir trecho, volta à ordem do documento. Se o prompt passar de 16.000
     caracteres, saem os trechos de menor nota. `usedChunks` é quantos trechos ficaram no prompt.
5. **Prompt**: instrução, a lista de campos (`key`, tipo, label e opções) e os trechos.
6. **Limpeza da resposta**: acha o objeto JSON no meio do texto, descarta chaves que não são campos, converte nulos,
   datas e opções (ver [Decisões](#decisões)).
7. **Regras de exibição**: campo visível quando todas as condições do `attached` valem; `formData` só com os visíveis;
   `missingRequired` = obrigatórios visíveis e vazios.
8. **Gravação** no Mongo e resposta `201`. Se qualquer passo falhar, nada é gravado.

## Arquitetura

```
src/
  routes/          HTTP: parâmetros, status, formato da resposta
  services/        orquestração (pipeline de extração, RAG)
  domain/          regras puras, sem IO: limpeza da resposta, regras de exibição, chunking, cosseno, prompt
  integrations/    IO: MongoDB (repositórios), LIA (chat e embeddings), leitura de PDF
  middlewares/     upload do PDF, tratamento de erros
  config/          leitura e validação das variáveis de ambiente
scripts/seed.js    npm run seed
test/              unit/ (domínio) e integration/ (Mongo, rotas, upload, client da LIA)
```

Cada camada só conhece a de baixo. Nenhuma regra conhece empresa ou campo pelo nome: tudo é dirigido pelos dados de
`data/`, e uma terceira empresa funciona sem mudar código.

**Stack:** Express 5, driver oficial `mongodb`, `multer` (upload em memória), `pdf-parse` 2, `zod` (validação do env e
do seed), `date-fns` (datas), `fetch` nativo, `node:test` + `supertest`.

## Decisões

### Pós-processamento da resposta da IA
- **Nulos**: `"INDEFINIDO"`, `"NÃO SE APLICA"`, `"N/A"` e vazio são comparados **exatamente** (depois de tirar os
  espaços das pontas), como o enunciado lista. `"indefinido"` em minúsculas não vira `null`.
- **Espaços nas pontas** são removidos em todos os tipos, não só em `text`: espaço nas pontas nunca é conteúdo, e sem isso
  `" 22/01/2025"` viraria `null` em silêncio.
- **Datas**: só `DD/MM/AAAA` e `AAAA-MM-DD`, a string inteira, com validação de calendário (`31/02/2025` → `null`).
- **Opções**: igualdade com o `value` ou o `label`, ignorando só caixa e acento. O `value` tem prioridade se uma opção
  tiver o mesmo texto que o label de outra. Nada de semelhança parcial.
- **Valores que não são texto** (número, booleano) viram texto; objeto e lista viram `null`.
- **`type` desconhecido** (uma terceira empresa com um tipo novo) é tratado como texto e gera um aviso no log, em vez
  de derrubar o seed ou a extração.
- **Resposta sem objeto JSON** → 502. JSON válido com campos faltando não é erro: os ausentes viram `null`. Sem retry:
  o mock é determinístico.

### Regras de exibição
- **Cascata**: um campo oculto conta como vazio para os campos que dependem dele. Com os dados atuais o resultado é o
  mesmo sem cascata (os campos repetem a condição do pai), mas para outra empresa evita mostrar um campo cuja condição
  depende de um valor que não está no formulário.
- `attached` apontando para um campo inexistente → condição falsa → campo oculto.

### PDF e estratégia
- **Até 5 páginas, o texto vai inteiro**, como o enunciado manda, mesmo que passe de 16.000 caracteres. Nesse caso o mock
  responde 413 e a API responde 502 (ver [Limitações](#limitações-conhecidas)).
- **PDF detectado pelo conteúdo** (`%PDF-` nos primeiros 1024 bytes), não pelo mimetype, que vem do cliente.
- **PDF corrompido ou com senha** → 400. **PDF sem texto** (digitalizado) segue o fluxo: 201 com os campos `null` e os
  obrigatórios em `missingRequired`.
- **Empresa inexistente responde 404 mesmo sem arquivo**: a checagem fica no handler, depois de receber o upload, para não
  responder antes de consumir o corpo (o cliente poderia receber `ECONNRESET` em vez do 404).
- **`pdf-parse` 2**: comparado com a versão 1 nos dois PDFs (mesmas páginas, todas as evidências do mock presentes); a 2
  usa o pdf.js atual e gera texto ~8% menor.

### RAG
- **Chunking** por janela fixa de caracteres com sobreposição, como no material de apoio sobre RAG. Garante que todo trecho
  de até 200 caracteres cabe inteiro em algum chunk. O texto não é reescrito (sem colapsar espaços nem tirar acentos):
  o mock compara as evidências com o texto do prompt.
- **`topK` por frase**: `queries.json` só traz textos, então cada frase usa `RAG_DEFAULT_TOP_K` (2). O seed também aceita
  `{ "text": "...", "topK": 3 }` para definir o `topK` de uma frase.
- **Sem repetir trecho**: a seleção é a união dos `topK` de cada frase; um trecho escolhido por duas frases entra uma vez,
  sem completar com o próximo.
- **Embeddings numa chamada só**: o contrato do mock não limita o número de entradas.
- **Empresa sem frases de busca**: nenhum trecho é enviado (sem frase, nenhum trecho é "relevante") e os campos saem `null`.
- Com os valores padrão, o `processo-longo` usa 12 trechos e um prompt de 15.424 caracteres, com todas as evidências
  presentes. O enunciado mostra `usedChunks: 11`, mas diz que o número depende do RAG; os parâmetros não foram ajustados
  para bater esse valor.

### Seed
- Idempotente por **índice único** (`key`; `companyKey + key`; `companyKey + position`) e upsert com `replaceOne`: um
  atributo removido do arquivo some do banco, e campos que saíram do arquivo são removidos.
- Atributos desconhecidos dos campos são preservados, para o `GET /fields` devolver o formato do arquivo.
- Erro estrutural (campo sem `key`, `companyKey` sem empresa, chave duplicada) falha o seed com código ≠ 0; no Docker,
  isso impede a API de subir com o banco vazio.

### Respostas
- A extração devolve `createdAt` além dos campos do exemplo (o enunciado o cita e diz que campos a mais não atrapalham).
- `GET /companies/:companyKey/fields` de uma empresa existente sem campos → `200 []`.
- `companyKey` é comparada exatamente (`ACME-EDU` → 404).

## Limitações conhecidas

- **PDF de até 5 páginas com mais de 16.000 caracteres** → 502 (`LIA_ERROR`, `upstreamCode: context_length_exceeded`).
  O enunciado manda enviar o texto inteiro até 5 páginas; a densidade medida vai de ~2.000 a ~3.800 caracteres por
  página, então 5 páginas densas passam do limite.
- **Corte do prompt pela menor nota**: se o RAG escolher trechos demais, o corte pode tirar o único trecho de uma frase.
  Com os dados atuais não há corte.
- **Nulos em outra grafia** (`"indefinido"`, `"NAO SE APLICA"`) não viram `null` num campo de texto, porque o enunciado
  lista os valores exatos.

## O que eu faria com mais tempo

- **Testes de integração mais amplos**: uma terceira empresa fictícia criada só em `data/` (com `attached` em cascata),
  carregada pelo seed e extraída via HTTP contra o mock, provando que funciona sem mudar código e uma bateria de PDFs
  além dos dois fornecidos (densos, digitalizados, com senha).
- **PDF curto que não cabe no prompt**: aplicar o RAG também nesse caso, em vez de responder 502.
- **Retry com backoff** para falhas transitórias da IA.
- **OCR** para PDFs digitalizados, sem texto.
- **Embeddings em lotes** de tamanho configurável: provedores reais limitam o número de entradas e de tokens por chamada.
- **Empresa sem frases de busca**: um fallback (por exemplo, o começo do documento até o limite do prompt) no lugar do
  formulário vazio.
- **CORS configurável na API**, para o front chamá-la direto, sem o proxy de desenvolvimento.
