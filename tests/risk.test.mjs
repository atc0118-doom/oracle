
// Unit tests for the pure logic in api/risk.js.
//
// Run with: node --test tests/risk.test.mjs
// (Node's built-in test runner — no dependencies to install.)
//
// These deliberately cover the functions that have caused real, user-visible
// bugs in this project before (see git history / chat history):
//   - countOccurrences: the "attack" vs "attacks" word-boundary bug that
//     caused real military headlines to fall through to a "General" driver.
//   - the satire-detection filter: the "Iran War Participation Trophy"
//     headline getting counted as a Military-driver signal.
//   - the concentration-penalty design fix: a severe, single-region conflict
//     shouldn't score lower than a milder multi-region one.
// This is not exhaustive coverage of risk.js — it targets the specific
// failure modes that have already bitten this project once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countOccurrences,
  clamp,
  round1,
  stateFromScore,
  dedupeArticles,
  stabilityAdjustment,
  globalSynchronizationAdjustment,
  duplicateNoiseReduction,
  normalizeOutlook,
  getVerifiedSources,
  SATIRE_INDICATOR_TERMS
} from '../api/risk.js';

const MILITARY_TERMS = ['military','missile','drone','airstrike','troops','army','navy','air force','attack','defense','war','combat','shelling','weapon','fighter','strike'];

test('countOccurrences matches simple plurals (regression: attack/attacks)', () => {
  const title = 'us attacks iran as tehran retaliates against uae tankers';
  assert.equal(countOccurrences(title, MILITARY_TERMS), 1, 'should match "attacks" via the "attack" keyword');
});

test('countOccurrences matches strike/strikes plural too', () => {
  assert.equal(countOccurrences('rebels launch new strikes overnight', MILITARY_TERMS), 1);
});

test('countOccurrences does not match unrelated substrings', () => {
  // 'warring' should not incorrectly match 'war' as a whole word beyond the plural allowance
  assert.equal(countOccurrences('the warring factions met for talks', ['war']), 0);
});

test('SATIRE_INDICATOR_TERMS flags the known false-positive headline', () => {
  const title = "'iran war participation trophy' on national mall mocks trump";
  const isSatire = SATIRE_INDICATOR_TERMS.some(t => title.includes(t));
  assert.equal(isSatire, true);
});

test('SATIRE_INDICATOR_TERMS does not flag a real strike headline', () => {
  const title = 'us attacks iran as tehran retaliates against uae tankers in strait of hormuz and bahrain';
  const isSatire = SATIRE_INDICATOR_TERMS.some(t => title.includes(t));
  assert.equal(isSatire, false);
});

test('clamp bounds values within range', () => {
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-10, 0, 100), 0);
  assert.equal(clamp(50, 0, 100), 50);
  assert.equal(clamp(NaN, 0, 100), 0, 'NaN should fall back to 0, not propagate');
});

test('round1 rounds to one decimal place', () => {
  assert.equal(round1(46.249), 46.2);
  assert.equal(round1(46.25), 46.3);
});

test('stateFromScore thresholds', () => {
  assert.equal(stateFromScore(0), 'STABLE');
  assert.equal(stateFromScore(29), 'STABLE');
  assert.equal(stateFromScore(30), 'WATCH');
  assert.equal(stateFromScore(49), 'WATCH');
  assert.equal(stateFromScore(50), 'HIGH');
  assert.equal(stateFromScore(69), 'HIGH');
  assert.equal(stateFromScore(70), 'CRITICAL');
  assert.equal(stateFromScore(100), 'CRITICAL');
});

test('normalizeOutlook only allows known labels, defaults to STABLE', () => {
  assert.equal(normalizeOutlook('ESCALATING'), 'ESCALATING');
  assert.equal(normalizeOutlook('escalating'), 'ESCALATING');
  assert.equal(normalizeOutlook('made up nonsense'), 'STABLE');
  assert.equal(normalizeOutlook(''), 'STABLE');
});

test('dedupeArticles collapses near-identical headlines', () => {
  const sharedStem = 'US attacks Iran as Tehran retaliates against UAE tankers in the strait';
  const articles = [
    { title: `${sharedStem} overnight` },
    { title: `${sharedStem}, officials say` },
    { title: 'A completely unrelated earthquake hits Japan' }
  ];
  const out = dedupeArticles(articles);
  assert.equal(out.length, 2, 'the two headlines sharing an identical first-12-word stem should collapse into one');
});

test('duplicateNoiseReduction skips the check under 8 signals', () => {
  const few = Array.from({length: 5}, (_, i) => ({ title: `Unique headline number ${i}` }));
  const result = duplicateNoiseReduction(few);
  assert.equal(result.value, 0);
});

test('duplicateNoiseReduction penalizes heavy duplication at volume', () => {
  const dupey = Array.from({length: 10}, () => ({ title: 'Same exact headline repeated over and over again' }));
  const result = duplicateNoiseReduction(dupey);
  assert.ok(result.value < 0, 'heavy duplication should produce a negative adjustment');
});

test('globalSynchronizationAdjustment: concentration penalty applies when driver is NOT severe', () => {
  const result = globalSynchronizationAdjustment([{ share: 88 }], { Military: 40 });
  assert.equal(result.value, -3);
});

test('globalSynchronizationAdjustment: concentration penalty is skipped when Military is severe (regression)', () => {
  // This is the exact scenario from the production bug report: a severe,
  // single-region war (Military evidence near-max) should not be scored
  // lower than a milder, multi-region situation just for being concentrated.
  const result = globalSynchronizationAdjustment([{ share: 87 }], { Military: 92 });
  assert.equal(result.value, 0);
  assert.ok(result.reasons.some(r => r.includes('no concentration discount')));
});

test('stabilityAdjustment: baseline -3 applies with no other conditions met', () => {
  // Logistics/Finance must be kept >=22 here, otherwise the "-2 no economic
  // spillover" rule also fires and this wouldn't isolate the baseline alone.
  const result = stabilityAdjustment({ Military: 0, Diplomatic: 0, Logistics: 25, Finance: 25 }, [{ score: 0 }], 20, [{ share: 0 }]);
  assert.equal(result.value, -3);
});

test('stabilityAdjustment: low total signal volume is penalized', () => {
  const result = stabilityAdjustment({ Military: 0, Diplomatic: 0, Logistics: 30, Finance: 30 }, [{ score: 0 }], 5, [{ share: 0 }]);
  assert.ok(result.value <= -8, 'low volume (-5) should stack with the baseline (-3)');
});

test('getVerifiedSources excludes baseline-placeholder articles', () => {
  const articles = [
    { source: 'Reuters', sourceType: 'news-api' },
    { source: 'ORACLE Baseline', sourceType: 'baseline-placeholder' },
    { source: 'ORACLE System', sourceType: 'baseline-placeholder' }
  ];
  const sources = getVerifiedSources(articles);
  assert.ok(!sources.includes('ORACLE Baseline'));
  assert.ok(!sources.includes('ORACLE System'));
  assert.ok(sources.includes('Reuters'));
});
