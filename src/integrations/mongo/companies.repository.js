import { getDb } from './client.js';

export function findCompanyByKey(key) {
  return getDb().collection('companies').findOne({ key }, { projection: { _id: 0 } });
}
