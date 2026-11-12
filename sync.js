// ESPN's unofficial fantasy API can change. All imported stats remain editable.
const SLOT = {0:'QB',2:'RB',4:'WR',6:'TE',16:'D/ST',17:'K',23:'FLEX',3:'FLEX',5:'FLEX',7:'FLEX',20:'FLEX',21:'FLEX'};
const BENCH = new Set([12,13,14,15,18,19,22,24,25]);
const val=(s,id)=>Number(s?.[String(id)]||0);
function statLine(entry,week){
  const p=entry.playerPoolEntry?.player||entry.player||{};
  const statEntries=p.stats||entry.playerPoolEntry?.stats||[];
  const actual=statEntries.find(s=>s.statTypeId===0 && Number(s.scoringPeriodId)===week && (!s.seasonId || Number(s.seasonId)===state.season));
  const s=actual?.stats || actual?.appliedStats;
  if(!s)return null;
  const slot=SLOT[entry.lineupSlotId]||'OTHER';
  const isDST=slot==='D/ST', isK=slot==='K';
  // ESPN raw stat identifiers; IDs 1 (completions) and 23 (carries) are conventional.
  // Fumble recoveries are ESPN stat 96; forced fumbles may not be exposed separately.
  const out={slot,player:p.fullName||p.name||String(entry.playerId),...Object.fromEntries(fields.map(f=>[f,0]))};
  if(isDST){
    out.sacks=val(s,99);out.ints=val(s,95);out.fr=val(s,96);out.safeties=val(s,98);out.blocks=val(s,97);
    out.tds=[93,101,102,103,104].reduce((a,id)=>a+val(s,id),0);
  }else if(isK){
    out.fg=[74,77,80].reduce((a,id)=>a+val(s,id),0);out.xp=val(s,86);
  }else{
    out.passYds=val(s,3);out.rushYds=val(s,24);out.recYds=val(s,42);
    out.completions=val(s,1);out.carries=val(s,23);out.receptions=val(s,53);
    out.tds=val(s,4)+val(s,25)+val(s,43);
  }
  return out;
}
function extractEntries(side,teams,teamId){
  const direct=side?.rosterForCurrentScoringPeriod?.entries;
  if(Array.isArray(direct)&&direct.length)return direct;
  return teams.find(t=>t.id===teamId)?.roster?.entries||[];
}
function importESPN(data,week){
  const teams=[...(data.teams||[])].sort((a,b)=>a.id-b.id);
  if(teams.length!==14)throw Error(`ESPN returned ${teams.length} teams, not 14. Import stopped to avoid misranking teams.`);
  const index=new Map(teams.map((t,i)=>[t.id,i]));
  const sides=new Map();
  for(const game of data.schedule||[])for(const side of [game.home,game.away])if(side?.teamId!=null)sides.set(side.teamId,side);
  if(sides.size<14)throw Error(`ESPN returned box scores for only ${sides.size} teams. Import stopped.`);
  const result={};const warnings=[];
  for(const team of teams){
    const side=sides.get(team.id);
    const entries=extractEntries(side,teams,team.id);
    if(!entries.length)throw Error(`No lineup data for ${team.name}. Import stopped.`);
    const starters=entries.filter(e=>!BENCH.has(Number(e.lineupSlotId)) && SLOT[e.lineupSlotId]);
    if(!starters.length)throw Error(`No starters found for ${team.name}. Import stopped.`);
    const rows=[];
    for(const e of starters){const r=statLine(e,week);if(!r)throw Error(`Missing actual weekly stats for starter ${e.playerPoolEntry?.player?.fullName||e.playerId} (${team.name}). Try a completed week.`);rows.push(r);}
    result[index.get(team.id)]=rows;
  }
  // ESPN may omit forced fumbles and other optional defensive counting stats.
  warnings.push('Review D/ST: forced fumbles, tackles for loss, three-and-outs, fourth-down stops and defensive 2-point returns are not reliably provided by this endpoint and default to zero.');
  warnings.push('ESPN stat 96 is interpreted as fumble recoveries. Check unusual defensive and return TDs against ESPN box scores.');
  state.teams=teams.map(t=>t.name||`${t.location||''} ${t.nickname||''}`.trim()||`Team ${t.id}`);
  state.weeks[String(week)]=result;
  state.weights=Object.fromEntries(defenseFields.map(f=>[f,1]));
  state.includeOtherPassing=false;
  save();renderAll();
  return warnings;
}
async function syncESPN(){
 const b=document.getElementById('espnSync');const msg=document.getElementById('espnStatus');
 b.disabled=true;msg.textContent=`Retrieving 2026 league data for ${state.season}, week ${state.week}…`;
 try{
  const response=await fetch(`/api/espn?year=${encodeURIComponent(state.season)}&week=${encodeURIComponent(state.week)}`);
  const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);
  if(!confirm(`Import ESPN's Week ${state.week} lineup and statistics for all 14 teams? This replaces manually entered stats for this week.`))return;
  const warnings=importESPN(data,state.week);
  msg.textContent=`Imported week ${state.week}. ${warnings.join(' ')}`;
 }catch(e){msg.textContent=`Sync failed: ${e.message} No existing stats were overwritten.`;}
 finally{b.disabled=false;}
}
document.getElementById('espnSync').addEventListener('click',syncESPN);
