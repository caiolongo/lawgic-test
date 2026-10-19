import { getDb } from './client.js';

export function findFieldsByCompany(companyKey) {
  return getDb()
    .collection('fields')
    .find({ companyKey }, { projection: { _id: 0 } })
    .sort({ order: 1, key: 1 })
    .toArray();
}
