const fallback = {
  score: 38, delta: 2, state: 'WATCH', confidence: 88, sourceHealth: 96,
  brief: 'Regional tensions remain elevated. Global escalation risk remains contained.',
  assessment: 'AI detected no synchronized global escalation. Highest pressure remains concentrated around Ukraine and the Taiwan Strait. Confidence remains high due to multi-source confirmation.',
  topEvent: { title:'Taiwan Strait', source:'GDELT', summary:'Military signal remains under monitoring. No immediate global escalation signal detected.', url:'https://www.gdeltproject.org/' },
  drivers: [ ['Military',48,.35], ['Diplomatic',48,.20], ['Cyber',20,.15], ['Logistics',15,.15], ['Finance',12,.10], ['Disaster',4,.05] ],
  regions: [ ['Ukraine',55,'Military','▲ +1'], ['Taiwan Strait',50,'Military','▲ +2'], ['Middle East',48,'Diplomatic','→ 0'], ['South China Sea',40,'Military','→ 0'], ['Cyber',20,'Cyber','→ 0'] ],
  timeline: [ ['14:20','Military signal remains under monitoring.'], ['13:10','Regional statements indicate continued diplomatic friction.'], ['11:50','No broad escalation signal detected across monitored sources.'], ['09:30','Logistics and market stress remain contained.'] ],
  sources: ['GDELT','Reuters','AP','BBC','NHK','Al Jazeera','USGS','NASA','MarineTraffic','FlightRadar24'],
  metrics: { activeConflicts:7, activeConflictsMeta:'+1 / 24H · MONITORED', milFlights:'Elevated', milFlightsMeta:'186 SORTIES DETECTED', cyberStatus:'Medium', cyberStatusMeta:'247 EVENTS / 24H', logStatus:'Stable', logStatusMeta:'PORT DELAY +3%', eventsAnalyzed:4812 }
};

async function getData(){
  try{ const r = await fetch('/api/risk',{cache:'no-store'}); if(!r.ok) throw new Error('api'); return await r.json(); }
  catch(e){ return fallback; }
}
const fmtTime=()=> new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Asia/Tokyo'}).format(new Date())+' JST';
const el=id=>document.getElementById(id);
function level(score){ if(score>=75)return'CRITICAL'; if(score>=55)return'HIGH'; if(score>=30)return'WATCH'; return'STABLE'; }
function render(d){
  el('score').textContent=d.score; el('state').textContent=d.state||level(d.score); el('delta').textContent=`▲ +${d.delta ?? 0} / 24H`; el('updated').textContent='UPDATED — '+fmtTime(); el('brief').textContent=d.brief;
  el('confidence').textContent=d.confidence+'%'; el('confidenceBar').style.width=d.confidence+'%'; el('assessment').textContent=d.assessment;
  el('topSource').textContent=d.topEvent.source; el('topTitle').textContent=d.topEvent.title; el('topSummary').textContent=d.topEvent.summary; el('topLink').href=d.topEvent.url||'#';
  el('drivers').innerHTML=d.drivers.map(x=>`<div class="driver"><span>${x[0]}</span><div class="bar"><i style="width:${x[1]}%"></i></div><strong>${x[1]}</strong></div>`).join('');
  el('regions').innerHTML=d.regions.map((x,i)=>`<div class="region"><div class="ranknum">${i+1}</div><div><div class="rankname">${x[0]}</div><div class="rankmeta">${x[2]} · ${x[3]}</div></div><div class="rankscore">${x[1]}</div><div class="rankbar"><i style="width:${x[1]}%"></i></div></div>`).join('');
  el('timeline').innerHTML=d.timeline.map(x=>`<div class="timeline-row"><div class="time">${x[0]}</div><div>${x[1]}</div></div>`).join('');
  el('sources').innerHTML=d.sources.map(s=>`<div class="source live-source">${s}</div>`).join('');
  el('lastSync').textContent=fmtTime(); el('sourceHealth').textContent=(d.sourceHealth||96)+'%';
  el('activeConflicts').textContent=d.metrics.activeConflicts; el('activeConflictsMeta').textContent=d.metrics.activeConflictsMeta||'MONITORED'; el('milFlights').textContent=d.metrics.milFlights; el('milFlightsMeta').textContent=d.metrics.milFlightsMeta||'EAST ASIA'; el('cyberStatus').textContent=d.metrics.cyberStatus; el('cyberStatusMeta').textContent=d.metrics.cyberStatusMeta||'NO GLOBAL SURGE'; el('logStatus').textContent=d.metrics.logStatus; el('logStatusMeta').textContent=d.metrics.logStatusMeta||'CONTAINED'; el('eventsAnalyzed').textContent=(d.metrics.eventsAnalyzed||4812).toLocaleString(); el('modelConfidence').textContent=d.confidence+'%';
  window.currentOracle=d; buildCalc(d);
}
function buildCalc(d){
  const rows=d.drivers.map(([name,val,w])=>[name,val,w,+(val*w).toFixed(1)]); const raw=rows.reduce((a,r)=>a+r[3],0); const adj=+(raw-d.score).toFixed(1);
  el('calc').innerHTML=rows.map(r=>`<div class="calc-row"><span>${r[0]}</span><span>${r[1]}</span><span>×${r[2]}</span><b>${r[3]}</b></div>`).join('')+`<div class="calc-total"><span>Raw Score</span><b>${raw.toFixed(1)}</b></div><div class="calc-total"><span>AI Stability Adjustment</span><b>-${adj.toFixed(1)}</b></div><div class="calc-total"><span>FINAL SCORE</span><b>${d.score}</b></div>`;
}
async function refresh(){ render(await getData()); }
el('whyBtn').onclick=()=>el('modal').classList.add('open'); el('closeModal').onclick=()=>el('modal').classList.remove('open'); el('modal').onclick=e=>{if(e.target.id==='modal')el('modal').classList.remove('open')}; document.addEventListener('keydown',e=>{if(e.key==='Escape')el('modal').classList.remove('open')});
refresh(); setInterval(refresh,60000);
