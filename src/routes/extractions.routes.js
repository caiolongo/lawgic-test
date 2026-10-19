import { Router } from 'express';
import { getExtraction } from '../services/extraction.service.js';

export function extractionsRouter() {
  const router = Router();

  router.get('/:id', async (req, res) => {
    res.json(await getExtraction(req.params.id));
  });

  return router;
}
