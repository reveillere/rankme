import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCcfText, dblpKeyFromUrl } from './ccfPortal.js';

// A real excerpt of pdf-parse's own text extraction of the official CCF
// PDF (first three sections: recommended journals, A/B/C) -- not a
// hand-crafted fixture, so it carries the actual quirks that broke a first
// pass at this parser: a title wrapping across two lines (TCAD, TVLSI), an
// entry with no separate acronym (Parallel Computing, Concurrency and
// Computation), a bare/no-trailing-slash url (FGCS, Integration), and an
// acronym itself hyphen-wrapped across lines (CCF-\nTHPC).
const SAMPLE_TEXT = `
中国计算机学会推荐国际学术会议和期刊目录
（2026年）
中国计算机学会

-- 1 of 72 --

中国计算机学会推荐国际学术期刊
一、A \t类
序号 \t期刊简称 \t期刊全称 \t出版社 \t网址
1 \tTOCS \tACM \tTransactions \ton \tComputer \tSystems \tACM \thttp://dblp.uni-trier.de/db/journals/tocs/
2 \tTOS \tACM \tTransactions \ton \tStorage \tACM \thttp://dblp.uni-trier.de/db/journals/tos/
3 \tTCAD IEEE \tTransactions \ton \tComputer-Aided \tDesign \tof \tIntegrated
Circuits \tand \tSystems IEEE \thttp://dblp.uni-trier.de/db/journals/tcad/
（计算机体系结构/并行与分布计算/存储系统）

-- 2 of 72 --

二、B \t类
序号 \t期刊简称 \t期刊全称 \t出版社 \t网址
5 \tTVLSI IEEE \tTransactions \ton \tVery \tLarge \tScale \tIntegration \t(VLSI)
Systems IEEE \thttp://dblp.uni-trier.de/db/journals/tvlsi/
8 \tParallel \tComputing \tElsevier \thttps://dblp.org/db/journals/pc/index.html

-- 3 of 72 --

三、C \t类
序号 \t期刊简称 \t期刊全称 \t出版社 \t网址
2 \tConcurrency \tand \tComputation: \tPractice \tand \tExperience \tWiley \thttp://dblp.uni-trier.de/db/journals/concurrency/
4 \tFGCS \tFuture \tGeneration \tComputer \tSystems \tElsevier \thttp://dblp.uni-trier.de/db/journals/fgcs
11 CCF-
THPC CCF \tTransactions \ton \tHigh \tPerformance \tComputing \tCCF \thttps://dblp.org/db/journals/ccfthpc/index.html
`;

test('parseCcfText: extracts one entry per row with the section-heading rank', () => {
  const entries = parseCcfText(SAMPLE_TEXT);
  // 3 in section A (TOCS, TOS, TCAD), 2 in B (TVLSI, Parallel Computing),
  // 3 in C (Concurrency, FGCS, CCF-THPC).
  assert.equal(entries.length, 8);
  assert.deepEqual(entries.map((e) => e.rank), ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'C']);
});

test('parseCcfText: a title wrapping across two pdf-parse text lines stays one entry', () => {
  const entries = parseCcfText(SAMPLE_TEXT);
  const tcad = entries.find((e) => e.url.endsWith('/journals/tcad/'));
  assert.ok(tcad, 'TCAD entry should be found');
  assert.equal(tcad.rank, 'A');
  assert.match(tcad.text, /Computer-Aided Design of Integrated Circuits and Systems/);

  const tvlsi = entries.find((e) => e.url.endsWith('/journals/tvlsi/'));
  assert.ok(tvlsi, 'TVLSI entry should be found');
  assert.equal(tvlsi.rank, 'B');
  assert.match(tvlsi.text, /Very Large Scale Integration \(VLSI\) Systems/);
});

test('parseCcfText: an entry with no separate acronym still parses (single-name row)', () => {
  const entries = parseCcfText(SAMPLE_TEXT);
  const pc = entries.find((e) => e.url.includes('/journals/pc/'));
  assert.ok(pc);
  assert.equal(pc.rank, 'B');
  assert.match(pc.text, /Parallel Computing/);
});

test('parseCcfText: a url with no trailing slash is still captured correctly', () => {
  const entries = parseCcfText(SAMPLE_TEXT);
  const fgcs = entries.find((e) => e.text.includes('FGCS'));
  assert.ok(fgcs);
  assert.equal(fgcs.url, 'http://dblp.uni-trier.de/db/journals/fgcs');
  assert.equal(dblpKeyFromUrl(fgcs.url), 'journals/fgcs');
});

test('parseCcfText: an acronym hyphen-wrapped across lines does not break the entry', () => {
  const entries = parseCcfText(SAMPLE_TEXT);
  const thpc = entries.find((e) => e.url.includes('ccfthpc'));
  assert.ok(thpc, 'CCF-THPC entry should still be found despite the mid-word line wrap');
  assert.equal(thpc.rank, 'C');
});

test('dblpKeyFromUrl: matches rankme\'s own dblp.url shape (no leading slash)', () => {
  assert.equal(dblpKeyFromUrl('db/journals/tocs/tocs64.html#Xyz'), 'journals/tocs');
  assert.equal(dblpKeyFromUrl('db/conf/infocom/infocom2026.html#MendiboureDSADETBR26'), 'conf/infocom');
});

test('dblpKeyFromUrl: matches CCF\'s own dblp url shape (dblp.uni-trier.de or dblp.org host)', () => {
  assert.equal(dblpKeyFromUrl('http://dblp.uni-trier.de/db/journals/tocs/'), 'journals/tocs');
  assert.equal(dblpKeyFromUrl('https://dblp.org/db/conf/ppopp/'), 'conf/ppopp');
});

test('dblpKeyFromUrl: two different publications in the same venue collapse to the same key', () => {
  const a = dblpKeyFromUrl('db/conf/ppopp/ppopp2020.html#Foo');
  const b = dblpKeyFromUrl('db/conf/ppopp/ppopp2021.html#Bar');
  assert.equal(a, b);
});

test('dblpKeyFromUrl: not a dblp conf/journals url -> null', () => {
  assert.equal(dblpKeyFromUrl('db/series/lncs/lncs12345'), null);
  assert.equal(dblpKeyFromUrl(''), null);
  assert.equal(dblpKeyFromUrl(null), null);
});
