const INDEXES = {
  companies: [{ key: { key: 1 }, unique: true }],
  fields: [
    { key: { companyKey: 1, key: 1 }, unique: true },
    { key: { companyKey: 1, order: 1 } },
  ],
  queries: [{ key: { companyKey: 1, position: 1 }, unique: true }],
  extractions: [{ key: { companyKey: 1, createdAt: -1 } }],
};

export async function ensureIndexes(db) {
  await Promise.all(
    Object.entries(INDEXES).map(([collection, specs]) => db.collection(collection).createIndexes(specs)),
  );
}
