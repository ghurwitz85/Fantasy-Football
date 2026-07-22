import fs from 'node:fs/promises';
const rankings=JSON.parse(await fs.readFile(new URL('../data/rankings.json',import.meta.url)));
const players=rankings.players||rankings;
if(!Array.isArray(players)||players.length<25) throw new Error('rankings.json needs at least 25 players');
for(const [i,p] of players.entries()) if(!p.name||!Number.isFinite(Number(p.rank))) throw new Error(`Invalid ranking row ${i}`);
const teams=JSON.parse(await fs.readFile(new URL('../data/team-context.json',import.meta.url)));
if(Object.keys(teams.teams||teams).length<32) throw new Error('team-context.json needs 32 teams');
console.log(`Validated ${players.length} players and 32 team contexts.`);
