import { format, isValid, parse } from 'date-fns';
import { normalizeForCompare } from './text-normalize.js';

const EMPTY_VALUES = new Set(['', 'INDEFINIDO', 'NÃO SE APLICA', 'N/A'].map(normalizeForCompare));

const DATE_FORMATS = [
  { pattern: /^\d{2}\/\d{2}\/\d{4}$/, format: 'dd/MM/yyyy' },
  { pattern: /^\d{4}-\d{2}-\d{2}$/, format: 'yyyy-MM-dd' },
];

export function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;
  return EMPTY_VALUES.has(normalizeForCompare(value.trim()));
}

export function parseText(value) {
  return value.trim();
}

export function parseDate(value) {
  const match = DATE_FORMATS.find(({ pattern }) => pattern.test(value));
  if (!match) return null;

  const date = parse(value, match.format, new Date());
  return isValid(date) ? format(date, 'yyyy-MM-dd') : null;
}

export function parseSelect(value, options = []) {
  const target = normalizeForCompare(value);
  const match =
    options.find((option) => normalizeForCompare(option.value) === target) ??
    options.find((option) => normalizeForCompare(option.label) === target);
  return match ? match.value : null;
}

const PARSERS = {
  text: (value) => parseText(value),
  date: (value) => parseDate(value),
  select: (value, field) => parseSelect(value, field.options),
};

export function isKnownFieldType(type) {
  return Object.hasOwn(PARSERS, type);
}

export function parseFieldValue(field, raw) {
  const value = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw;
  if (isEmptyValue(value) || typeof value !== 'string') return null;

  const parser = isKnownFieldType(field.type) ? PARSERS[field.type] : PARSERS.text;
  return parser(value.trim(), field);
}

export function sanitizeAiOutput(fields, raw) {
  return Object.fromEntries(
    fields.map((field) => [field.key, parseFieldValue(field, Object.hasOwn(raw, field.key) ? raw[field.key] : undefined)]),
  );
}
