import { createHash } from 'node:crypto';
import type { EmbeddingVector } from './contracts';

type CanonicalFields = {
  title: string;
  topic?: string | null;
  angle?: string | null;
  hookText?: string | null;
  coreMessage?: string | null;
};

const synonymGroups = [
  ['老板', '店主', '掌柜'],
  ['手切', '现切', '鲜切'],
  ['团购', '套餐', '优惠'],
  ['新鲜', '当天', '现杀'],
  ['门店', '店里', '到店'],
] as const;

function normalize(value: string) {
  let result = value.toLocaleLowerCase().normalize('NFKC');
  for (const [canonical, ...synonyms] of synonymGroups)
    for (const synonym of synonyms)
      result = result.replaceAll(synonym, canonical);
  return result.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function canonicalContentText(value: CanonicalFields) {
  return [
    value.title,
    value.topic ?? '',
    value.angle ?? '',
    value.hookText ?? '',
    value.coreMessage ?? '',
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .join('\n');
}

export function contentSourceHash(value: CanonicalFields) {
  return createHash('sha256').update(canonicalContentText(value)).digest('hex');
}

export function weightedTermVector(text: string): EmbeddingVector {
  const normalized = normalize(text);
  const compact = normalized.replaceAll(' ', '');
  const weights: Record<string, number> = {};
  const add = (term: string, weight: number) => {
    if (!term) return;
    weights[term] = (weights[term] ?? 0) + weight;
  };
  for (const word of normalized.match(/[a-z0-9]{2,}/g) ?? []) add(word, 3);
  const characters = Array.from(compact);
  for (const character of characters) add(character, 0.35);
  for (let index = 0; index < characters.length - 1; index += 1)
    add(characters[index] + characters[index + 1], 2);
  for (let index = 0; index < characters.length - 2; index += 1)
    add(characters[index] + characters[index + 1] + characters[index + 2], 2.5);
  return { kind: 'weighted_terms', weights };
}

function sparseCosine(
  left: Record<string, number>,
  right: Record<string, number>,
) {
  const [smaller, larger] =
    Object.keys(left).length <= Object.keys(right).length
      ? [left, right]
      : [right, left];
  let dot = 0;
  for (const [key, value] of Object.entries(smaller))
    dot += value * (larger[key] ?? 0);
  const leftNorm = Math.sqrt(
    Object.values(left).reduce((total, value) => total + value * value, 0),
  );
  const rightNorm = Math.sqrt(
    Object.values(right).reduce((total, value) => total + value * value, 0),
  );
  return leftNorm && rightNorm ? dot / (leftNorm * rightNorm) : 0;
}

function denseCosine(left: number[], right: number[]) {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function vectorSimilarity(
  left: EmbeddingVector,
  right: EmbeddingVector,
) {
  const value =
    left.kind === 'dense' && right.kind === 'dense'
      ? denseCosine(left.values, right.values)
      : left.kind === 'weighted_terms' && right.kind === 'weighted_terms'
        ? sparseCosine(left.weights, right.weights)
        : 0;
  return Math.min(1, Math.max(0, value));
}

export function textSimilarity(left: string, right: string) {
  if (!left.trim() || !right.trim()) return 0;
  return vectorSimilarity(weightedTermVector(left), weightedTermVector(right));
}

export function roundedScore(value: number) {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000;
}
