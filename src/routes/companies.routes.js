import { Router } from 'express';
import { getCompanyFields } from '../services/company.service.js';
import { createExtraction } from '../services/extraction.service.js';
import { pdfUpload } from '../middlewares/pdf-upload.js';
import { createLiaClient } from '../integrations/lia/lia.client.js';

export function companiesRouter({ config, logger }) {
  const router = Router();
  const upload = pdfUpload({ maxBytes: config.upload.maxBytes });
  const extractionDeps = {
    lia: createLiaClient(config.lia),
    rag: config.rag,
    maxPromptChars: config.prompt.maxChars,
    logger,
  };

  router.get('/:companyKey/fields', async (req, res) => {
    res.json(await getCompanyFields(req.params.companyKey));
  });

  router.post('/:companyKey/extractions', upload, async (req, res) => {
    res.status(201).json(await createExtraction(req.params.companyKey, req.file, extractionDeps));
  });

  return router;
}
