import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeXmlEntities } from './crossref.js';

// Regression for a live venue text shown as "Software &amp; Systems
// Modeling" instead of "Software & Systems Modeling" -- Crossref's own
// container-title occasionally carries the raw XML escaping verbatim.
test('decodeXmlEntities decodes the named XML entities', () => {
    assert.equal(decodeXmlEntities('Software &amp; Systems Modeling'), 'Software & Systems Modeling');
    assert.equal(decodeXmlEntities('A &lt;B&gt; &quot;C&quot; &apos;D&apos;'), 'A <B> "C" \'D\'');
});

test('decodeXmlEntities decodes decimal and hex numeric references', () => {
    assert.equal(decodeXmlEntities('caf&#233;'), 'café');
    assert.equal(decodeXmlEntities('caf&#xe9;'), 'café');
});

test('decodeXmlEntities leaves plain text and nullish input untouched', () => {
    assert.equal(decodeXmlEntities('Plain text, no entities'), 'Plain text, no entities');
    assert.equal(decodeXmlEntities(null), null);
    assert.equal(decodeXmlEntities(undefined), undefined);
});
