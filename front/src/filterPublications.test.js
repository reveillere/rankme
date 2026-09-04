import { describe, it, expect } from 'vitest';
import { filterPublications } from './filterPublications';

const yearAccessor = (pub) => pub.year;

const base = { yearAccessor, filterYears: [2000, 2026], filterCategories: { article: true, book: false }, filterRanks: { A: true, B: false } };

describe('filterPublications', () => {
  it('keeps publications inside the year range and drops the rest', () => {
    const pubs = [{ year: 1999, type: 'article' }, { year: 2010, type: 'article' }, { year: 2026, type: 'article' }, { year: 2027, type: 'article' }];
    const result = filterPublications(pubs, base);
    expect(result.map(p => p.year)).toEqual([2010, 2026]);
  });

  it('keeps publications with no year at all (HAL records can lack one)', () => {
    const pubs = [{ year: undefined, type: 'article' }, { year: null, type: 'article' }, { year: 1980, type: 'article' }];
    const result = filterPublications(pubs, base);
    expect(result).toHaveLength(2);
  });

  it('filters by category using the type field', () => {
    const pubs = [{ year: 2020, type: 'article' }, { year: 2020, type: 'book' }];
    const result = filterPublications(pubs, base);
    expect(result.map(p => p.type)).toEqual(['article']);
  });

  it('filters by rank when a publication has one, but never drops unranked publications', () => {
    const pubs = [
      { year: 2020, type: 'article', rank: { value: 'A' } },
      { year: 2020, type: 'article', rank: { value: 'B' } },
      { year: 2020, type: 'article' }, // no rank at all, e.g. a book chapter
    ];
    const result = filterPublications(pubs, base);
    expect(result).toHaveLength(2);
    expect(result.some(p => p.rank?.value === 'B')).toBe(false);
  });

  it('applies all three filters together', () => {
    const pubs = [
      { year: 2020, type: 'article', rank: { value: 'A' } }, // keep
      { year: 1990, type: 'article', rank: { value: 'A' } }, // out of range
      { year: 2020, type: 'book', rank: { value: 'A' } },    // wrong category
      { year: 2020, type: 'article', rank: { value: 'B' } }, // wrong rank
    ];
    const result = filterPublications(pubs, base);
    expect(result).toEqual([pubs[0]]);
  });
});
