/** Pure, bounded-cost PDF-page matching and change detection. No browser dependencies. */
export interface PageSnapshot {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
  thumbnail: string;
  /** RGBA pixels; any valid dimensions are normalized to a 128 × 72 comparison sample. */
  pixels: Uint8ClampedArray;
  pixelWidth: number;
  pixelHeight: number;
}

export interface TextDiffOperation {
  type: 'equal' | 'add' | 'remove';
  text: string;
}

export interface NumberDiff {
  added: string[];
  removed: string[];
}

export interface ComparisonRow {
  id: string;
  before?: PageSnapshot;
  after?: PageSnapshot;
  /** Matching affinity, not a calibrated probability. Range: 0–1. */
  similarity: number;
  uncertain: boolean;
  uncertaintyReasons: string[];
  manual: boolean;
  moved: boolean;
  textChanged: boolean;
  visualChanged: boolean;
  changed: boolean;
  /** Fraction of sampled pixels with a mean RGB difference greater than 18/255. */
  visualDifference: number;
  /** False when either page has no usable raster sample. */
  visualAvailable: boolean;
  textDiff: TextDiffOperation[];
  /** True when a large edited span is grouped to keep text diffing bounded. */
  textDiffCoarse: boolean;
  numberDiff: NumberDiff;
}

export interface ComparePairOptions {
  manual?: boolean;
  uncertain?: boolean;
  similarity?: number;
  uncertaintyReasons?: string[];
}

export const MAX_PAGES = 50;
export const PIXEL_DIFFERENCE_THRESHOLD = 18;
export const MATCH_THRESHOLD = 0.52;
const WIDTH = 128;
const HEIGHT = 72;
const PIXEL_COUNT = WIDTH * HEIGHT;
const MAX_DIFF_CELLS = 300_000;
const AMBIGUITY_MARGIN = 0.055;

interface PageFeatures {
  page: PageSnapshot;
  normalizedText: string;
  words: string[];
  wordsCount: Map<string, number>;
  bigramsCount: Map<string, number>;
  rgb?: Uint8Array;
  ink?: Float32Array;
  tiles?: Float32Array;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const normalizeText = (text: string) => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();

function frequencies(tokens: string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const token of tokens) result.set(token, (result.get(token) ?? 0) + 1);
  return result;
}

function makeFeatures(page: PageSnapshot): PageFeatures {
  const normalizedText = normalizeText(page.text).toLocaleLowerCase('en-US');
  const words = normalizedText.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  const features: PageFeatures = {
    page,
    normalizedText,
    words,
    wordsCount: frequencies(words),
    bigramsCount: frequencies(words.slice(1).map((word, i) => `${words[i]}\u0000${word}`)),
  };
  const { pixels, pixelWidth: pw, pixelHeight: ph } = page;
  if (!Number.isInteger(pw) || !Number.isInteger(ph) || pw < 1 || ph < 1 ||
      !pixels || pixels.length < pw * ph * 4) return features;

  const rgb = new Uint8Array(PIXEL_COUNT * 3);
  const ink = new Float32Array(PIXEL_COUNT);
  const tiles = new Float32Array(16 * 9 * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const source = (Math.min(ph - 1, Math.floor((y + 0.5) * ph / HEIGHT)) * pw +
        Math.min(pw - 1, Math.floor((x + 0.5) * pw / WIDTH))) * 4;
      const index = y * WIDTH + x;
      const tile = (Math.floor(y / 8) * 16 + Math.floor(x / 8)) * 3;
      const alpha = pixels[source + 3] / 255;
      let darkness = 0;
      for (let channel = 0; channel < 3; channel++) {
        const value = Math.round(pixels[source + channel] * alpha + 255 * (1 - alpha));
        rgb[index * 3 + channel] = value;
        tiles[tile + channel] += value / 64;
        darkness += 255 - value;
      }
      ink[index] = darkness / (255 * 3);
    }
  }
  return { ...features, rgb, ink, tiles };
}

function weightedDice(a: Map<string, number>, b: Map<string, number>, weights?: Map<string, number>): number {
  let total = 0;
  let overlap = 0;
  for (const [key, count] of a) {
    const weight = weights?.get(key) ?? 1;
    total += count * weight;
    overlap += Math.min(count, b.get(key) ?? 0) * weight;
  }
  for (const [key, count] of b) total += count * (weights?.get(key) ?? 1);
  return total ? (2 * overlap) / total : 0;
}

function inverseDocumentFrequency(features: PageFeatures[], key: 'wordsCount' | 'bigramsCount'): Map<string, number> {
  const counts = new Map<string, number>();
  for (const feature of features) {
    for (const token of feature[key].keys()) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return new Map([...counts].map(([token, count]) => [token, 1 + Math.log((features.length + 1) / (count + 1))]));
}

interface RasterComparison { similarity: number; difference: number; available: boolean }
function compareRasters(a: PageFeatures, b: PageFeatures): RasterComparison {
  if (!a.rgb || !b.rgb || !a.ink || !b.ink || !a.tiles || !b.tiles) {
    return { similarity: 0.5, difference: 0, available: false };
  }
  let weightedDifference = 0;
  let weights = 0;
  let changedPixels = 0;
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const offset = i * 3;
    const difference = (Math.abs(a.rgb[offset] - b.rgb[offset]) +
      Math.abs(a.rgb[offset + 1] - b.rgb[offset + 1]) +
      Math.abs(a.rgb[offset + 2] - b.rgb[offset + 2])) / 3;
    if (difference > PIXEL_DIFFERENCE_THRESHOLD) changedPixels++;
    // Keep whitespace from making unrelated mostly-white pages appear identical.
    const weight = 0.015 + Math.max(a.ink[i], b.ink[i]);
    weightedDifference += difference * weight;
    weights += weight;
  }
  let tileDifference = 0;
  for (let i = 0; i < a.tiles.length; i++) tileDifference += Math.abs(a.tiles[i] - b.tiles[i]);
  const pixelSimilarity = clamp(1 - 2.7 * weightedDifference / (weights * 255));
  const tileSimilarity = clamp(1 - 2.3 * tileDifference / (a.tiles.length * 255));
  return {
    similarity: 0.85 * pixelSimilarity + 0.15 * tileSimilarity,
    difference: changedPixels / PIXEL_COUNT,
    available: true,
  };
}

function pairAffinity(a: PageFeatures, b: PageFeatures, wordWeights?: Map<string, number>, bigramWeights?: Map<string, number>): number {
  const raster = compareRasters(a, b);
  if (!a.words.length && !b.words.length) return raster.available ? raster.similarity : 0;
  if (!a.words.length || !b.words.length) return raster.available ? raster.similarity * 0.8 : 0;
  const textSimilarity = a.normalizedText === b.normalizedText ? 1 :
    0.45 * weightedDice(a.wordsCount, b.wordsCount, wordWeights) +
    0.55 * (a.bigramsCount.size && b.bigramsCount.size
      ? weightedDice(a.bigramsCount, b.bigramsCount, bigramWeights)
      : weightedDice(a.wordsCount, b.wordsCount, wordWeights));
  if (!raster.available) return textSimilarity;
  const textWeight = Math.min(a.words.length, b.words.length) >= 6 ? 0.8 : 0.55;
  return clamp(textWeight * textSimilarity + (1 - textWeight) * raster.similarity);
}

function pushDiff(operations: TextDiffOperation[], type: TextDiffOperation['type'], text: string) {
  if (!text) return;
  const previous = operations[operations.length - 1];
  if (previous?.type === type) previous.text += text;
  else operations.push({ type, text });
}

/** Word-level LCS with a strict matrix-size cap and exact common prefix/suffix. */
export function diffText(before: string, after: string): { operations: TextDiffOperation[]; coarse: boolean } {
  const aText = normalizeText(before);
  const bText = normalizeText(after);
  if (aText === bText) return { operations: aText ? [{ type: 'equal', text: aText }] : [], coarse: false };
  const a = aText.match(/\S+\s*/gu) ?? [];
  const b = bText.match(/\S+\s*/gu) ?? [];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const aMiddle = a.slice(prefix, a.length - suffix);
  const bMiddle = b.slice(prefix, b.length - suffix);
  const operations: TextDiffOperation[] = [];
  pushDiff(operations, 'equal', a.slice(0, prefix).join(''));
  const coarse = aMiddle.length * bMiddle.length > MAX_DIFF_CELLS;
  if (coarse || !aMiddle.length || !bMiddle.length) {
    pushDiff(operations, 'remove', aMiddle.join(''));
    pushDiff(operations, 'add', bMiddle.join(''));
  } else {
    const columns = bMiddle.length + 1;
    const table = new Uint16Array((aMiddle.length + 1) * columns);
    for (let i = aMiddle.length - 1; i >= 0; i--) {
      for (let j = bMiddle.length - 1; j >= 0; j--) {
        table[i * columns + j] = aMiddle[i] === bMiddle[j]
          ? table[(i + 1) * columns + j + 1] + 1
          : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < aMiddle.length || j < bMiddle.length) {
      if (i < aMiddle.length && j < bMiddle.length && aMiddle[i] === bMiddle[j]) {
        pushDiff(operations, 'equal', aMiddle[i++]); j++;
      } else if (i < aMiddle.length && (j === bMiddle.length ||
          table[(i + 1) * columns + j] >= table[i * columns + j + 1])) {
        pushDiff(operations, 'remove', aMiddle[i++]);
      } else pushDiff(operations, 'add', bMiddle[j++]);
    }
  }
  pushDiff(operations, 'equal', suffix ? a.slice(a.length - suffix).join('') : '');
  return { operations, coarse };
}

/** Recognizes complete dates, amounts, percentages and ordinary numeric tokens. */
export function extractNumbers(text: string): string[] {
  const month = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const currency = '(?:US\\$|CA\\$|A\\$|USD|EUR|GBP|JPY|CAD|AUD|CHF|INR|CNY|[$€£¥₹₩₽])';
  const amount = "(?:\\d{1,3}(?:[, '’]\\d{3})+|\\d+)(?:[.,]\\d+)?";
  const expression = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?:` +
    `\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|` +
    `\\d{1,2}[-/.]\\d{1,2}[-/.]\\d{2,4}|` +
    `${month}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|` +
    `\\d{1,2}\\s+${month}\\.?(?:\\s+\\d{4})?|` +
    `Q[1-4]\\s+\\d{4}|` +
    `[+\\-−]?(?:${currency}\\s*)?[+\\-−]?${amount}(?:[kKmMbB](?![\\p{L}]))?(?:\\s*(?:%|percent\\b|${currency}))?` +
    `)(?![\\p{L}\\p{N}_])`, 'giu');
  return (normalizeText(text).match(expression) ?? []).map(number => number.trim());
}

export function diffNumbers(before: string, after: string): NumberDiff {
  const a = extractNumbers(before);
  const b = extractNumbers(after);
  const remainingBefore = frequencies(a);
  const remainingAfter = frequencies(b);
  const removed: string[] = [];
  const added: string[] = [];
  for (const number of a) {
    if (remainingAfter.get(number)) remainingAfter.set(number, remainingAfter.get(number)! - 1);
    else removed.push(number);
  }
  for (const number of b) {
    if (remainingBefore.get(number)) remainingBefore.set(number, remainingBefore.get(number)! - 1);
    else added.push(number);
  }
  return { added, removed };
}

function weakEvidence(a: PageFeatures, b: PageFeatures): string[] {
  const reasons: string[] = [];
  if (Math.min(a.words.length, b.words.length) < 5 || Math.min(a.wordsCount.size, b.wordsCount.size) < 3) {
    reasons.push('Little or no extractable text; visual similarity cannot verify semantic equivalence.');
  }
  if (!a.rgb || !b.rgb) reasons.push('A usable visual sample is unavailable.');
  return reasons;
}

function makeRow(before: PageSnapshot | undefined, after: PageSnapshot | undefined, options: ComparePairOptions,
  a?: PageFeatures, b?: PageFeatures): ComparisonRow {
  if (!before && !after) throw new Error('A comparison row must contain at least one page.');
  const paired = Boolean(before && after);
  const raster = a && b ? compareRasters(a, b) : { similarity: 0, difference: 0, available: false };
  const textDiff = diffText(before?.text ?? '', after?.text ?? '');
  const textChanged = normalizeText(before?.text ?? '') !== normalizeText(after?.text ?? '');
  const geometryChanged = paired && (Math.abs(before!.width - after!.width) > 0.5 || Math.abs(before!.height - after!.height) > 0.5);
  const visualChanged = paired ? raster.difference > 0 || geometryChanged : true;
  const similarity = options.similarity ?? (a && b ? pairAffinity(a, b) : 0);
  const reasons = [...(options.uncertaintyReasons ?? (a && b ? weakEvidence(a, b) : []))];
  // A manually confirmed identity cannot establish semantic equivalence for a scan.
  const mandatoryReview = Boolean(a && b && (!a.words.length || !b.words.length || !raster.available));
  if (paired && similarity < 0.7 && !reasons.some(reason => reason.startsWith('Weak matching'))) {
    reasons.push('Weak matching evidence; confirm that these pages belong together.');
  }
  return {
    id: `before-${before?.pageNumber ?? 'none'}-after-${after?.pageNumber ?? 'none'}`,
    before, after, similarity: clamp(similarity),
    uncertain: mandatoryReview || (options.uncertain ?? reasons.length > 0),
    uncertaintyReasons: reasons,
    manual: options.manual ?? false,
    moved: paired && before!.pageNumber !== after!.pageNumber,
    textChanged,
    visualChanged,
    changed: !paired || textChanged || visualChanged,
    visualDifference: paired ? raster.difference : 1,
    visualAvailable: paired ? raster.available : Boolean((a ?? b)?.rgb),
    textDiff: textDiff.operations,
    textDiffCoarse: textDiff.coarse,
    numberDiff: diffNumbers(before?.text ?? '', after?.text ?? ''),
  };
}

/** Recompute a manually selected pair, or an explicit added/deleted page. */
export function comparePair(before?: PageSnapshot, after?: PageSnapshot, options: ComparePairOptions = {}): ComparisonRow {
  return makeRow(before, after, options, before ? makeFeatures(before) : undefined, after ? makeFeatures(after) : undefined);
}

/** Hungarian minimum-cost assignment. Square matrix, O(n³), n ≤ 100 here. */
function optimalAssignment(cost: number[][]): number[] {
  const n = cost.length;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const p = new Int32Array(n + 1);
  const way = new Int32Array(n + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(n + 1).fill(Infinity);
    const used = new Uint8Array(n + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) if (!used[j]) {
        const current = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (current < minv[j]) { minv[j] = current; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
  return assignment;
}

/** Global content-based alignment with free unmatched dummy nodes; order is only a tie-breaker. */
export function matchPages(before: PageSnapshot[], after: PageSnapshot[]): ComparisonRow[] {
  if (before.length > MAX_PAGES || after.length > MAX_PAGES) throw new RangeError(`Decks are limited to ${MAX_PAGES} pages each.`);
  if (!before.length && !after.length) return [];
  const a = before.map(makeFeatures);
  const b = after.map(makeFeatures);
  const wordWeights = inverseDocumentFrequency([...a, ...b], 'wordsCount');
  const bigramWeights = inverseDocumentFrequency([...a, ...b], 'bigramsCount');
  const scores = a.map(left => b.map(right => pairAffinity(left, right, wordWeights, bigramWeights)));
  const n = a.length + b.length;
  const cost = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) =>
    i < a.length && j < b.length
      ? MATCH_THRESHOLD - scores[i][j] + Math.abs(i - j) * 1e-8
      : 0));
  const assignment = optimalAssignment(cost);
  const usedAfter = new Set<number>();
  const rows: ComparisonRow[] = [];
  for (let i = 0; i < a.length; i++) {
    const j = assignment[i];
    if (j >= 0 && j < b.length && scores[i][j] > MATCH_THRESHOLD) {
      usedAfter.add(j);
      const reasons = weakEvidence(a[i], b[j]);
      const alternatives = [
        ...scores[i].filter((_, candidate) => candidate !== j),
        ...scores.filter((_, candidate) => candidate !== i).map(row => row[j]),
      ];
      if (alternatives.some(score => score >= MATCH_THRESHOLD && score >= scores[i][j] - AMBIGUITY_MARGIN)) {
        reasons.push('Similar alternative matches or duplicate pages; review this pairing.');
      }
      rows.push(makeRow(before[i], after[j], { similarity: scores[i][j], uncertaintyReasons: reasons }, a[i], b[j]));
    } else {
      const candidate = scores[i].length ? Math.max(...scores[i]) : 0;
      const reasons = candidate >= MATCH_THRESHOLD - AMBIGUITY_MARGIN
        ? ['No reliable unique match; check whether this page was deleted or substantially edited.'] : [];
      rows.push(makeRow(before[i], undefined, { uncertain: reasons.length > 0, uncertaintyReasons: reasons }, a[i]));
    }
  }
  for (let j = 0; j < b.length; j++) if (!usedAfter.has(j)) {
    const candidate = a.length ? Math.max(...scores.map(row => row[j])) : 0;
    const reasons = candidate >= MATCH_THRESHOLD - AMBIGUITY_MARGIN
      ? ['No reliable unique match; check whether this page was added or substantially edited.'] : [];
    rows.push(makeRow(undefined, after[j], { uncertain: reasons.length > 0, uncertaintyReasons: reasons }, undefined, b[j]));
  }
  return rows.sort((left, right) =>
    (left.after?.pageNumber ?? left.before!.pageNumber) - (right.after?.pageNumber ?? right.before!.pageNumber) ||
    Number(Boolean(left.after)) - Number(Boolean(right.after)));
}
