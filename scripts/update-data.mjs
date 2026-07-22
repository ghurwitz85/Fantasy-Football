import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = path.join(root, 'data');
await fs.mkdir(dataDir, { recursive: true });

const headers = { Accept: 'application/json,text/csv;q=0.9,*/*;q=0.8' };
if (process.env.RANKINGS_API_KEY) headers.Authorization = `Bearer ${process.env.RANKINGS_API_KEY}`;

function splitCsvLine(line) {
  const out=[]; let cur=''; let quoted=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"' && quoted && line[i+1]==='"'){cur+='"';i++;}
    else if(c==='"') quoted=!quoted;
    else if(c===',' && !quoted){out.push(cur);cur='';}
    else cur+=c;
  }
  out.push(cur); return out;
}
function normalizeRankings(payload) {
  const rows = Array.isArray(payload) ? payload : payload.players || payload.rankings || payload.data || [];
  return rows.map((r, i) => ({
    name: r.name || r.player_name || r.player || r.full_name,
    team: r.team || r.player_team_id || r.team_abbr || '',
    position: String(r.position || r.pos || '').replace(/\d+$/,''),
    rank: Number(r.rank || r.overallRank || r.rank_ecr || r.ecr || i + 1),
    tier: Number(r.tier || 0) || null,
    bye: Number(r.bye || r.byeWeek || 0) || null,
    rankStdDev: Number(r.rankStdDev || r.rank_std_dev || r.sd || 0) || 0
  })).filter(r => r.name && Number.isFinite(r.rank));
}
function parseRankingsCsv(text) {
  const lines=text.trim().split(/\r?\n/).filter(Boolean); if(lines.length<2) return [];
  const h=splitCsvLine(lines[0]).map(x=>x.trim().toUpperCase());
  const col=(...names)=>h.findIndex(v=>names.some(n=>v===n||v.includes(n)));
  const ni=col('PLAYER NAME','PLAYER','NAME'), ti=col('TEAM'), pi=col('POS'), ri=col('RK','RANK','ECR'), tieri=col('TIER'), bi=col('BYE');
  return lines.slice(1).map((line,i)=>{const c=splitCsvLine(line); return {name:c[ni],team:ti>=0?c[ti]:'',position:pi>=0?String(c[pi]).replace(/\d+$/,''):'',rank:Number(ri>=0?c[ri]:i+1),tier:tieri>=0?Number(c[tieri])||null:null,bye:bi>=0?Number(c[bi])||null:null};}).filter(r=>r.name&&Number.isFinite(r.rank));
}
async function fetchPayload(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('json') || /^[\s]*[\[{]/.test(text)) return JSON.parse(text);
  return text;
}
async function updateRankings() {
  if (!process.env.RANKINGS_URL) { console.log('RANKINGS_URL not configured; retaining cached rankings.'); return; }
  const payload=await fetchPayload(process.env.RANKINGS_URL);
  const players=typeof payload==='string'?parseRankingsCsv(payload):normalizeRankings(payload);
  if(players.length<25) throw new Error(`Only ${players.length} ranking rows parsed; refusing to replace cache.`);
  await fs.writeFile(path.join(dataDir,'rankings.json'),JSON.stringify({generatedAt:new Date().toISOString(),source:process.env.RANKINGS_URL,players},null,2));
  console.log(`Updated ${players.length} rankings.`);
}
async function mirrorJson(envName, filename) {
  const url=process.env[envName]; if(!url) return;
  const payload=await fetchPayload(url); if(typeof payload==='string') throw new Error(`${envName} must return JSON.`);
  await fs.writeFile(path.join(dataDir,filename),JSON.stringify({...payload,generatedAt:new Date().toISOString()},null,2));
  console.log(`Updated ${filename}.`);
}
await updateRankings();
await mirrorJson('TEAM_CONTEXT_URL','team-context.json');
await mirrorJson('YAHOO_HISTORY_URL','yahoo-history-2025.json');
