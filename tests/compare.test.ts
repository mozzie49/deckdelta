import { describe, expect, it } from 'vitest';
import { comparePair, diffNumbers, diffText, extractNumbers, matchPages, type PageSnapshot } from '../src/compare';

function page(pageNumber: number, text: string, color = 255): PageSnapshot {
  const pixels = new Uint8ClampedArray(128 * 72 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = pixels[i + 1] = pixels[i + 2] = color;
    pixels[i + 3] = 255;
  }
  return { pageNumber, text, width: 960, height: 540, thumbnail: '', pixels, pixelWidth: 128, pixelHeight: 72 };
}
const textA = 'Our annual revenue grew through enterprise customers across Europe';
const textB = 'Product roadmap covers onboarding accessibility search and account settings';
const textC = 'Research interviews reveal opportunities for stronger collaboration and trust';

describe('global page matching', () => {
  it('recognizes distant reorder without marking unchanged content changed', () => {
    const before = [page(1, textA, 70), page(2, textB, 130), page(3, textC, 210)];
    const after = [page(1, textC, 210), page(2, textA, 70), page(3, textB, 130)];
    const rows = matchPages(before, after);
    expect(rows).toHaveLength(3);
    expect(rows.map(row => [row.before?.pageNumber, row.after?.pageNumber])).toEqual([[3, 1], [1, 2], [2, 3]]);
    expect(rows.every(row => row.moved && !row.changed && !row.uncertain)).toBe(true);
  });

  it('matches globally across the full 50-page deck rather than a local position window', () => {
    const before = Array.from({ length: 50 }, (_, index) => page(index + 1,
      `Topic${index} Detail${index} Evidence${index} Forecast${index} Finding${index} Conclusion${index}`, 50 + index * 3));
    const after = [...before].reverse().map((item, index) => ({ ...item, pageNumber: index + 1 }));
    const rows = matchPages(before, after);
    expect(rows).toHaveLength(50);
    expect(rows[0].before?.pageNumber).toBe(50);
    expect(rows[49].before?.pageNumber).toBe(1);
    expect(rows.every(row => row.moved && !row.changed)).toBe(true);
  });

  it('allows additions and deletions instead of forcing unrelated pages together', () => {
    const rows = matchPages([page(1, textA, 10), page(2, textB, 110)],
      [page(1, textA, 10), page(2, textC, 240)]);
    expect(rows).toHaveLength(3);
    expect(rows.filter(row => row.before && row.after)).toHaveLength(1);
    expect(rows.find(row => row.before?.text === textB)?.after).toBeUndefined();
    expect(rows.find(row => row.after?.text === textC)?.before).toBeUndefined();
    expect(rows.filter(row => !row.before || !row.after).every(row => row.changed && !row.moved)).toBe(true);
  });

  it('flags duplicates instead of presenting arbitrary assignment as certain', () => {
    const rows = matchPages([page(1, textA), page(2, textA)], [page(1, textA), page(2, textA)]);
    expect(rows.every(row => row.uncertain)).toBe(true);
    expect(rows.every(row => row.uncertaintyReasons.some(reason => /duplicate/.test(reason)))).toBe(true);
  });

  it('flags blank, image-only, and short-text pairs as uncertain', () => {
    for (const text of ['', 'Revenue', 'Q4 results']) {
      const [row] = matchPages([page(1, text, 130)], [page(1, text, 130)]);
      expect(row.uncertain).toBe(true);
      expect(row.changed).toBe(false);
    }
  });

  it('distinguishes moving and editing the same page', () => {
    const rows = matchPages([page(1, `${textA} $120 20%`, 70), page(2, textB, 190)],
      [page(1, textB, 190), page(2, `${textA} $140 25%`, 70)]);
    const edited = rows.find(row => row.before?.pageNumber === 1)!;
    expect(edited.moved).toBe(true);
    expect(edited.changed).toBe(true);
    expect(edited.textChanged).toBe(true);
    expect(edited.numberDiff).toEqual({ removed: ['$120', '20%'], added: ['$140', '25%'] });
  });

  it('handles empty documents and enforces the cap', () => {
    expect(matchPages([], [])).toEqual([]);
    expect(matchPages([], [page(1, textA)])[0].before).toBeUndefined();
    expect(matchPages([page(1, textA)], [])[0].after).toBeUndefined();
    expect(() => matchPages(Array.from({ length: 51 }, (_, index) => page(index + 1, textA)), [])).toThrow(/50/);
  });
});

describe('change detection', () => {
  it('detects a one-pixel localized image edit', () => {
    const before = page(1, textA);
    const after = page(1, textA);
    after.pixels[400] = 0;
    after.pixels[401] = 0;
    after.pixels[402] = 0;
    const row = comparePair(before, after);
    expect(row.visualChanged).toBe(true);
    expect(row.visualDifference).toBeCloseTo(1 / (128 * 72), 10);
    expect(row.changed).toBe(true);
    expect(row.textChanged).toBe(false);
  });

  it('uses an explicit pixel-noise threshold', () => {
    const before = page(1, textA, 100);
    expect(comparePair(before, page(1, textA, 118)).visualChanged).toBe(false);
    expect(comparePair(before, page(1, textA, 119)).visualChanged).toBe(true);
  });

  it('detects page geometry changes independently from normalized raster', () => {
    const before = page(1, textA);
    const after = { ...before, width: 1200 };
    expect(comparePair(before, after).visualChanged).toBe(true);
  });

  it('keeps case and punctuation changes in text diff but ignores extraction whitespace', () => {
    expect(comparePair(page(1, 'Revenue is strong.'), page(1, 'Revenue  is\nstrong.')).textChanged).toBe(false);
    const row = comparePair(page(1, 'Revenue is strong.'), page(1, 'Revenue is STRONG!'));
    expect(row.textChanged).toBe(true);
    expect(row.textDiff.some(operation => operation.type === 'remove' && operation.text.includes('strong.'))).toBe(true);
    expect(row.textDiff.some(operation => operation.type === 'add' && operation.text.includes('STRONG!'))).toBe(true);
  });

  it('supports manual pair recomputation without suppressing content changes', () => {
    const row = comparePair(page(1, 'Old $10'), page(7, 'New $20'), { manual: true, uncertain: false });
    expect(row.manual).toBe(true);
    expect(row.uncertain).toBe(false);
    expect(row.changed).toBe(true);
    expect(row.moved).toBe(true);
    expect(row.numberDiff).toEqual({ removed: ['$10'], added: ['$20'] });
  });

  it('does not claim visual verification when raster samples are unavailable', () => {
    const before = { ...page(1, textA), pixels: new Uint8ClampedArray() };
    const row = comparePair(before, page(1, textA));
    expect(row.visualAvailable).toBe(false);
    expect(row.uncertain).toBe(true);
  });

  it('keeps image-only comparisons uncertain after manual identity confirmation', () => {
    const row = comparePair(page(1, '', 100), page(3, '', 100), { manual: true, uncertain: false });
    expect(row.manual).toBe(true);
    expect(row.uncertain).toBe(true);
  });

  it('composites alpha against white before comparison', () => {
    const before = page(1, textA);
    const after = page(1, textA, 0);
    for (let i = 3; i < after.pixels.length; i += 4) after.pixels[i] = 0;
    expect(comparePair(before, after).visualChanged).toBe(false);
  });
});

describe('numeric differences', () => {
  it('preserves currency, signed amounts, percentages and complete dates', () => {
    expect(extractNumbers('Revenue $1,250.50, margin 20%, signed -€50, due 2026-10-01 and October 3, 2026.'))
      .toEqual(['$1,250.50', '20%', '-€50', '2026-10-01', 'October 3, 2026']);
  });

  it('reports numeric additions, removals, and repeated values with multiplicity', () => {
    expect(diffNumbers('10% 10% $20 2026-10-01', '10% $30 2026-11-01 42'))
      .toEqual({ removed: ['10%', '$20', '2026-10-01'], added: ['$30', '2026-11-01', '42'] });
  });

  it('does not invent numbers from ordinary embedded alphanumeric identifiers', () => {
    expect(extractNumbers('ModelZ24 has v2beta support')).toEqual([]);
  });
});

describe('bounded text diff', () => {
  it('reconstructs both normalized input texts', () => {
    const before = 'Shared start old value and unchanged ending';
    const after = 'Shared start new different value and unchanged ending';
    const { operations } = diffText(before, after);
    expect(operations.filter(operation => operation.type !== 'add').map(operation => operation.text).join('')).toBe(before);
    expect(operations.filter(operation => operation.type !== 'remove').map(operation => operation.text).join('')).toBe(after);
  });

  it('groups extremely large changes rather than constructing an unbounded matrix', () => {
    const before = Array.from({ length: 3000 }, (_, index) => `before${index}`).join(' ');
    const after = Array.from({ length: 3000 }, (_, index) => `after${index}`).join(' ');
    const result = diffText(before, after);
    expect(result.coarse).toBe(true);
    expect(result.operations).toHaveLength(2);
    expect(result.operations[0]).toEqual({ type: 'remove', text: before });
    expect(result.operations[1]).toEqual({ type: 'add', text: after });
  });
});
