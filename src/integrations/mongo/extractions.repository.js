import { ObjectId } from 'mongodb';
import { getDb } from './client.js';

export async function insertExtraction(doc) {
  const { insertedId } = await getDb().collection('extractions').insertOne({ ...doc });
  return { _id: insertedId, ...doc };
}

export async function findExtractionById(id) {
  if (!ObjectId.isValid(id)) return null;
  return getDb().collection('extractions').findOne({ _id: new ObjectId(id) });
}
