import { NotFoundError } from '../errors/http-errors.js';
import { findCompanyByKey } from '../integrations/mongo/companies.repository.js';
import { findFieldsByCompany } from '../integrations/mongo/fields.repository.js';

export async function getCompanyFields(companyKey) {
  const company = await findCompanyByKey(companyKey);
  if (!company) {
    throw new NotFoundError('Empresa não encontrada', { code: 'COMPANY_NOT_FOUND', details: { companyKey } });
  }
  return findFieldsByCompany(companyKey);
}
