import fs from 'node:fs/promises';

async function readJson(path) {
  return JSON.parse(await fs.readFile(new URL(path, import.meta.url)));
}

function rows(payload) {
  return payload.players || payload;
}

const rankings=JSON.parse(await fs.readFile(new URL('../data/rankings.json',import.meta.url)));
const players=rankings.players||rankings;
if(!Array.isArray(players)||players.length<25) throw new Error('rankings.json needs at least 25 players');
for(const [i,p] of players.entries()) if(!p.name||!Number.isFinite(Number(p.rank))) throw new Error(`Invalid ranking row ${i}`);
const teams=JSON.parse(await fs.readFile(new URL('../data/team-context.json',import.meta.url)));
if(Object.keys(teams.teams||teams).length<32) throw new Error('team-context.json needs 32 teams');

const projections = rows(await readJson('../data/projections.json'));
if(!Array.isArray(projections)||projections.length<3) throw new Error('projections.json needs player projections');
for(const [i,p] of projections.entries()) if(!p.name||!p.position||!p.projections) throw new Error(`Invalid projection row ${i}`);

const adp = rows(await readJson('../data/adp.json'));
if(!Array.isArray(adp)||adp.length<3) throw new Error('adp.json needs ADP rows');
for(const [i,p] of adp.entries()) if(!p.name||!Number.isFinite(Number(p.adp))) throw new Error(`Invalid ADP row ${i}`);

const playerMetadata = rows(await readJson('../data/players.json'));
if(!Array.isArray(playerMetadata)||playerMetadata.length<3) throw new Error('players.json needs player metadata rows');
for(const [i,p] of playerMetadata.entries()) if(!p.name||!p.team||!p.position) throw new Error(`Invalid player metadata row ${i}`);

const metadata = await readJson('../data/metadata.json');
for(const key of ['rankings','projections','adp','teamContext','yahooHistory']) {
  if(!metadata.feeds?.[key]?.status) throw new Error(`metadata.json missing feed status for ${key}`);
}

console.log(`Validated ${players.length} rankings, ${Object.keys(teams.teams||teams).length} team contexts, ${projections.length} projections, ${adp.length} ADP rows, and ${playerMetadata.length} player metadata rows.`);
