import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizePlayers } from '../js/data-loader.js';

test('player feed summary preserves metadata status and source details', () => {
  const summary = summarizePlayers({
    status: 'fulfilled',
    value: {
      source: 'FantasyPros 2026 rankings export with approximate ADP derived from ECR VS. ADP deltas.',
      players: [{ name: 'Bijan Robinson' }, { name: 'Jahmyr Gibbs' }],
    },
  }, { status: 'derived', path: 'data/adp.json' });

  assert.equal(summary.status, 'derived');
  assert.equal(summary.count, 2);
  assert.equal(summary.path, 'data/adp.json');
  assert.equal(summary.directness, 'derived');
  assert.match(summary.source, /approximate ADP/);
});

test('player feed summary still reports missing failed feeds', () => {
  const summary = summarizePlayers({ status: 'rejected', reason: new Error('missing') }, { status: 'loaded' });

  assert.equal(summary.status, 'missing');
  assert.equal(summary.count, 0);
});