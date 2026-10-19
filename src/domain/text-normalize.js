export function normalizeForCompare(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
