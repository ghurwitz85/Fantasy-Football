import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
test('cached rankings are ordered and usable', async()=>{
 const d=JSON.parse(await fs.readFile(new URL('../data/rankings.json',import.meta.url)));
 assert.ok(d.players.length>100);
 assert.equal(d.players[0].rank,1);
 assert.ok(d.players.every(p=>p.name&&p.position));
});
