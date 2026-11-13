// ESPN's unofficial API can change. Imported statistics remain editable.
const SLOT = {0:'QB',2:'RB',4:'WR',6:'TE',16:'D/ST',17:'K',23:'FLEX'};
const STARTER_SLOTS = new Set([0,2,4,6,16,17,23]);
const val=(s,id)=>Number(s?.[String(id)]||0);
const playerName=e=>e.playerPoolEntry?.player?.fullName||e.player?.fullName||String(e.playerId);
function statLine(entry,week,playingTeamIds){
  const p=entry.playerPoolEntry?.player||entry.player||{};
  const statEntries=p.stats||entry.playerPoolEntry?.stats||[];
  const actual=statEntries.find(s=>Number(s.statSourceId)===0 && Number(s.scoringPeriodId)===Number(week) && (!s.seasonId || Number(s.seasonId)===Number(state.season)));
  const s=actual?.stats || actual?.appliedStats;
  const slot=SLOT[Number(entry.lineupSlotId)]||'OTHER';
  const out={slot,player:p.fullName||p.name||String(entry.playerId),...Object.fromEntries(fields.map(f=>[f,0]))};
  if(!s){
    // NFL proTeamId is not the fantasy league's teamId. Only confirmed byes become zero.
    const proTeamId=Number(p.proTeamId ?? entry.playerPoolEntry?.proTeamId);
    if(!Number.isInteger(proTeamId)||proTeamId<=0)throw Error(`Missing actual stats for ${out.player}; cannot identify NFL team to verify a bye.`);
    if(playingTeamIds.has(proTeamId))throw Error(`Missing actual weekly stats for starter ${out.player} (NFL team played in week ${week}).`);
    out.bye=true;
    return out;
  }
  if(slot==='D/ST'){
    out.sacks=val(s,99);out.ints=val(s,95);out.fr=val(s,96);out.safeties=val(s,98);out.blocks=val(s,97);
    out.tds=[93,101,102,103,104].reduce((a,id)=>a+val(s,id),0);
  }else if(slot==='K'){
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
function importESPN(data,week,nflSchedule){
  const teams=[...(data.teams||[])].sort((a,b)=>a.id-b.id);
  if(teams.length!==14)throw Error(`ESPN returned ${teams.length} teams, not 14. Import stopped.`);
  if(Number(nflSchedule.year)!==Number(state.season)||Number(nflSchedule.week)!==Number(week)||!Array.isArray(nflSchedule.playingTeamIds)||nflSchedule.playingTeamIds.length<20)throw Error('NFL schedule could not be verified. No statistics were imported.');
  const playingTeamIds=new Set(nflSchedule.playingTeamIds.map(Number));
  const index=new Map(teams.map((t,i)=>[t.id,i]));
  const sides=new Map();
  for(const game of data.schedule||[])for(const side of [game.home,game.away])if(side?.teamId!=null)sides.set(side.teamId,side);
  if(sides.size<14)throw Error(`ESPN returned box scores for only ${sides.size} teams. Import stopped.`);
  const result={},warnings=[];
  for(const team of teams){
    const side=sides.get(team.id);
    const entries=extractEntries(side,teams,team.id);
    if(!entries.length)throw Error(`No lineup data for ${team.name}. Import stopped.`);
    const starters=entries.filter(e=>STARTER_SLOTS.has(Number(e.lineupSlotId)));
    const counts={};for(const e of starters){const id=Number(e.lineupSlotId);counts[id]=(counts[id]||0)+1;}
    if(starters.length!==9||counts[0]!==1||counts[2]!==2||counts[4]!==2||counts[6]!==1||counts[23]!==1||counts[16]!==1||counts[17]!==1)
      throw Error(`Unexpected starting lineup for ${team.name}: ${starters.length} starters. Import stopped to avoid inaccurate rankings.`);
    const rows=[];
    for(const e of starters){
      const r=statLine(e,week,playingTeamIds);
      if(r.bye)warnings.push(`${r.player} (${team.name}) was on a confirmed bye and counted as zero.`);
      rows.push(r);
    }
    result[index.get(team.id)]=rows;
  }
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
 const b=document.getElementById('espnSync'),msg=document.getElementById('espnStatus');
 b.disabled=true;msg.textContent=`Retrieving league data and NFL schedule for ${state.season}, week ${state.week}…`;
 try{
  const query=`year=${encodeURIComponent(state.season)}&week=${encodeURIComponent(state.week)}`;
  const [espnResponse,nflResponse]=await Promise.all([fetch(`/api/espn?${query}`),fetch(`/api/nfl-week?${query}`)]);
  const data=await espnResponse.json(),nfl=await nflResponse.json();
  if(!espnResponse.ok)throw Error(data.error||`ESPN HTTP ${espnResponse.status}`);
  if(!nflResponse.ok)throw Error(nfl.error||`NFL schedule HTTP ${nflResponse.status}`);
  if(!confirm(`Import ESPN's Week ${state.week} lineup and statistics for all 14 teams? This replaces manually entered stats for this week.`))return;
  const warnings=importESPN(data,state.week,nfl);
  msg.textContent=`Imported week ${state.week}. ${warnings.join(' ')}`;
 }catch(e){msg.textContent=`Sync failed: ${e.message} No existing stats were overwritten.`;}
 finally{b.disabled=false;}
}
document.getElementById('espnSync').addEventListener('click',syncESPN);
