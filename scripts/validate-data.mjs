import fs from 'node:fs/promises';

const TEAM_ALIASES = Object.freeze({ JAC: 'JAX', WSH: 'WAS', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB', LA: 'LAR' });
const VALID_TEAMS = new Set(['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','FA','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WAS']);
const VALID_POSITIONS = new Set(['QB','RB','WR','TE','K','DST']);

async function readJson(path) {
  return JSON.parse(await fs.readFile(new URL(path, import.meta.url)));
}

function rows(payload) {
  return payload.players || payload;
}

function normalizeTeam(code = '') {
  const value = String(code || '').trim().toUpperCase();
  return TEAM_ALIASES[value] || value;
}

function normalizePosition(position = '') {
  const match = String(position || '').toUpperCase().match(/QB|RB|WR|TE|K|DST|DEF/);
  if (!match) return '';
  return match[0] === 'DEF' ? 'DST' : match[0];
}

function normalizeName(name = '') {
  return String(name).toLowerCase().replace(/[’‘`']/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function validatePlayerIdentityRows(label, playerRows, { allowFreeAgents = true } = {}) {
  const seen = new Map();
  for (const [i, player] of playerRows.entries()) {
    const name = player.name || player.player || player.playerName;
    const team = normalizeTeam(player.team || player.player_team_id || '');
    const position = normalizePosition(player.position || player.pos || '');
    if (!name) throw new Error(`${label} row ${i} is missing player name`);
    if (!position || !VALID_POSITIONS.has(position)) throw new Error(`${label} row ${i} (${name}) has unknown position: ${player.position || player.pos || ''}`);
    if (team && (!VALID_TEAMS.has(team) || (!allowFreeAgents && team === 'FA'))) throw new Error(`${label} row ${i} (${name}) has unknown team: ${team}`);
    const key = `${normalizeName(name)}|${team || 'FA'}|${position}`;
    if (seen.has(key)) throw new Error(`${label} duplicate player detected: ${name} (${team || 'FA'} ${position}) rows ${seen.get(key)} and ${i}`);
    seen.set(key, i);
  }
}

const rankings=JSON.parse(await fs.readFile(new URL('../data/rankings.json',import.meta.url)));
const players=rankings.players||rankings;
if(!Array.isArray(players)||players.length<25) throw new Error('rankings.json needs at least 25 players');
for(const [i,p] of players.entries()) if(!p.name||!Number.isFinite(Number(p.rank))) throw new Error(`Invalid ranking row ${i}`);
validatePlayerIdentityRows('rankings.json', players);
const teams=JSON.parse(await fs.readFile(new URL('../data/team-context.json',import.meta.url)));
const teamRows = teams.teams||teams;
if(Object.keys(teamRows).length<32) throw new Error('team-context.json needs 32 teams');

function validateScore(value, label) {
  const number = Number(value);
  if(!Number.isFinite(number) || number < -1 || number > 1) throw new Error(`${label} must be a normalized -1..1 score`);
}

for(const [team,row] of Object.entries(teamRows)) {
  validateScore(row.quarterback?.overallScore, `${team} quarterback.overallScore`);
  validateScore(row.defense?.overallScore, `${team} defense.overallScore`);
  validateScore(row.expectedGameScript?.leadProbabilityScore, `${team} expectedGameScript.leadProbabilityScore`);
  validateScore(row.expectedGameScript?.trailingProbabilityScore, `${team} expectedGameScript.trailingProbabilityScore`);
}

const projections = rows(await readJson('../data/projections.json'));
if(!Array.isArray(projections)||projections.length<12) throw new Error('projections.json needs at least 12 player projections');
for(const [i,p] of projections.entries()) if(!p.name||!p.position||!p.projections) throw new Error(`Invalid projection row ${i}`);
validatePlayerIdentityRows('projections.json', projections, { allowFreeAgents: false });
const projectionCounts = projections.reduce((counts,p) => {
  const position = String(p.position||'').replace(/[0-9]/g,'').toUpperCase();
  counts[position] = (counts[position]||0)+1;
  return counts;
}, {});
for(const [position,minimum] of Object.entries({QB:2,RB:2,WR:2,TE:2})) {
  if((projectionCounts[position]||0)<minimum) throw new Error(`projections.json needs at least ${minimum} ${position} projections`);
}

const adp = rows(await readJson('../data/adp.json'));
if(!Array.isArray(adp)||adp.length<3) throw new Error('adp.json needs ADP rows');
for(const [i,p] of adp.entries()) if(!p.name||!Number.isFinite(Number(p.adp))) throw new Error(`Invalid ADP row ${i}`);
validatePlayerIdentityRows('adp.json', adp, { allowFreeAgents: false });

const playerMetadata = rows(await readJson('../data/players.json'));
if(!Array.isArray(playerMetadata)||playerMetadata.length<3) throw new Error('players.json needs player metadata rows');
for(const [i,p] of playerMetadata.entries()) if(!p.name||!p.team||!p.position) throw new Error(`Invalid player metadata row ${i}`);
validatePlayerIdentityRows('players.json', playerMetadata, { allowFreeAgents: false });

const metadata = await readJson('../data/metadata.json');
for(const key of ['rankings','projections','adp','teamContext','yahooHistory']) {
  if(!metadata.feeds?.[key]?.status) throw new Error(`metadata.json missing feed status for ${key}`);
}

console.log(`Validated ${players.length} rankings, ${Object.keys(teamRows).length} team contexts with normalized V3 scores, ${projections.length} projections (${Object.entries(projectionCounts).map(([pos,count])=>`${pos}:${count}`).join(', ')}), ${adp.length} ADP rows, and ${playerMetadata.length} player metadata rows.`);
