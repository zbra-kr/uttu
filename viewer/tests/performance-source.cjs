const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const baseline = path.join(__dirname, 'fixtures/performance-baseline');
const live = {
  'queries.ts': 'src/lib/queries.ts',
  'ranking-page.tsx': 'src/app/(app)/ranking/page.tsx',
  'reviews-page.tsx': 'src/app/(app)/reviews/page.tsx',
  'product-page.tsx': 'src/app/(app)/product/page.tsx',
  'ranking-mobile.tsx': 'src/app/(app)/ranking/MobileRankingView.tsx',
  'reviews-mobile.tsx': 'src/app/(app)/reviews/MobileReviewsView.tsx',
  'ranking-context.ts': 'src/lib/notes/ranking-context.ts',
  'useViewport.ts': 'src/hooks/useViewport.ts',
  'useResolvedViewport.ts': 'src/hooks/useResolvedViewport.ts',
  'format.ts': 'src/lib/format.ts',
};
const provenance = JSON.parse(fs.readFileSync(path.join(baseline, 'provenance.json')));
function readSource(reference) {
  const [variant, name] = reference.split('/');
  assert.ok(live[name], `Unknown test source ${reference}`);
  if (variant === 'source') {
    const source = fs.readFileSync(path.join(baseline, name + '.txt'), 'utf8');
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), provenance.sha256[name], `Baseline fixture changed: ${name}`);
    return source;
  }
  assert.ok(['abort-candidate','detail-candidate','viewport-candidate','current'].includes(variant), `Unknown variant ${variant}`);
  // Live source text may have Git's Windows CRLF checkout conversion. Normalize
  // only parser input; immutable baseline bytes above retain exact hash checks.
  return fs.readFileSync(path.join(__dirname, '..', live[name]), 'utf8').replace(/\r\n/g, '\n');
}
module.exports = { readSource };
