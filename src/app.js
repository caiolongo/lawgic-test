import express from 'express';
import { notFoundHandler, errorHandler } from './middlewares/error-handler.js';
import { companiesRouter } from './routes/companies.routes.js';
import { extractionsRouter } from './routes/extractions.routes.js';

export function createApp({ config, logger = console }) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/companies', companiesRouter({ config, logger }));
  app.use('/extractions', extractionsRouter());

  app.use(notFoundHandler());
  app.use(errorHandler({ logger }));

  return app;
}
