import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTeamRankingsDefenseHtml } from '../scripts/import-team-defense-rankings.mjs';

test('parses TeamRankings opponent points table and normalizes defense scores', () => {
  const rows = parseTeamRankingsDefenseHtml(`
    <table class="tr-table datatable scrollable"><tbody>
      <tr><td class="rank text-center" data-sort="1">1</td><td class="text-left nowrap" data-sort="Seattle"><a>Seattle</a></td><td class="text-right" data-sort="16.9">16.9</td></tr>
      <tr><td class="rank text-center" data-sort="2">2</td><td class="text-left nowrap" data-sort="Buffalo"><a>Buffalo</a></td><td class="text-right" data-sort="20.0">20.0</td></tr>
      <tr><td class="rank text-center" data-sort="3">3</td><td class="text-left nowrap" data-sort="Carolina"><a>Carolina</a></td><td class="text-right" data-sort="28.0">28.0</td></tr>
    </tbody></table>`);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].team, 'SEA');
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].pointsAllowedProjection, 16.9);
  assert.ok(rows[0].overallScore > rows[1].overallScore);
  assert.ok(rows[1].overallScore > rows[2].overallScore);
});