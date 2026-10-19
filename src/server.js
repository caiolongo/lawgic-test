import { loadConfig } from './config/env.js';
import { createApp } from './app.js';
import { connectMongo, closeMongo } from './integrations/mongo/client.js';
import { ensureIndexes } from './integrations/mongo/indexes.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function startServer() {
  const config = loadConfig();
  await ensureIndexes(await connectMongo(config.mongoUri));
  const app = createApp({ config, logger: console });

  const server = await new Promise((resolve, reject) => {
    const httpServer = app.listen(config.port);
    httpServer.once('listening', () => resolve(httpServer));
    httpServer.once('error', reject);
  });
  console.log(`Mini-LIA ouvindo na porta ${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} recebido, encerrando...`);

    setTimeout(() => {
      console.error('Encerramento excedeu o tempo limite, forçando saída');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    try {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await closeMongo();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch(async (error) => {
  console.error(error.message);
  process.exitCode = 1;
  await closeMongo();
});
