import { MongoClient } from 'mongodb';

let client;
let db;

export async function connectMongo(uri) {
  if (db) return db;

  const newClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await newClient.connect();
  client = newClient;
  db = newClient.db();
  return db;
}

export function getDb() {
  if (!db) throw new Error('MongoDB não conectado: chame connectMongo() antes');
  return db;
}

export async function closeMongo() {
  if (!client) return;
  const current = client;
  client = undefined;
  db = undefined;
  await current.close();
}
