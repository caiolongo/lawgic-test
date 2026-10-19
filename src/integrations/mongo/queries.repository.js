import { getDb } from './client.js';

export function findQueriesByCompany(companyKey) {
  return getDb()
    .collection('queries')
    .find({ companyKey }, { projection: { _id: 0, text: 1, topK: 1 } })
    .sort({ position: 1 })
    .toArray();
}
