import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSources } from './corePortal.js';

test('parseSources reads the CORE editions from the portal\'s source picker', () => {
  const html = `<html><body><form>
    <select name="by"><option>2099 not this one</option></select>
    <select name="source">
      <option value="all">All</option>
      <option value="CORE2023">CORE2023</option>
      <option value="CORE2021">  CORE2021 </option>
      <option value="ERA2010">ERA2010</option>
      <option value="x">Legacy</option>
    </select>
  </form></body></html>`;
  assert.deepEqual(parseSources(html), [
    { year: 2023, source: 'CORE2023' },
    { year: 2021, source: 'CORE2021' },
    { year: 2010, source: 'ERA2010' },
  ]);
});

test('parseSources returns nothing when the picker is missing', () => {
  assert.deepEqual(parseSources('<html><body>maintenance</body></html>'), []);
});
