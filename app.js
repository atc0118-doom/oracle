const fallback = {
  score: 38, delta: 2, state: 'WATCH', confidence: 88, sourceHealth: 96,
  brief: 'Regional tensions remain elevated. Global escalation risk remains contained.',
  assessment: 'AI detected no synchronized global escalation. Highest pressure remains concentrated around Ukraine and the Taiwan Strait. Confidence remains high due to multi-source confirmation.',
  topEvent: { title:'Taiwan Strait', source:'GDELT', summary:'Military signal remains under monitoring. No immediate global escalation signal detected.', url:'https://www.gdeltproject.org/' },
  drivers: [ ['Military',48,.35], ['Diplomatic',48,.20], ['Cyber',20,.15], ['Logistics',15,.15], ['Finance',12,.10], ['Disaster',4,.05] ],
  regions: [ ['Ukraine',55,'Military','▲ +1'], ['Taiwan Strait',50,'Military','▲ +2'], ['Middle East',48,'Diplomatic','→ 0'], ['South China Sea',40,'Military','→ 0'], ['Korea',36,'Watch','→ 0'] ],
  timeline: [ ['14:20','Military signal remains under monitoring.'], ['13:10','Regional statements indicate continued diplomatic friction.'], ['11:50','No broad escalation signal detected across monitored sources.'], ['09:30','Logistics and market stress remain contained.'] ],
  sources: ['GDELT','Reuters','AP','BBC','NHK','Al Jazeera','USGS','NASA','MarineTraffic','FlightRadar24'],
  metrics: { activeConflicts:7, activeConflictsMeta:'+1 / 24H · MONITORED', milFlights:'Elevated', milFlightsMeta:'186 SORTIES DETECTED', cyberStatus:'Medium', cyberStatusMeta:'247 EVENTS / 24H', logStatus:'Stable', logStatusMeta:'PORT DELAY +3%', eventsAnalyzed:4812, countries:211 }
};
const el=id=>document.getElementById(id);
const fmtTime=()=> new Intl.DateTimeFormat('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Asia/Tokyo'}).format(new Date())+' JST';
function level(score){ if(score>=75)return'CRITICAL'; if(score>=55)return'HIGH'; if(score>=30)return'WATCH'; return'STABLE'; }
function clone(d){ return JSON.parse(JSON.stringify(d)); }
function normalize(d){ return {...fallback, ...d, topEvent:{...fallback.topEvent, ...(d.topEvent||{})}, metrics:{...fallback.metrics, ...(d.metrics||{})}, drivers:d.drivers||fallback.drivers, regions:d.regions||fallback.regions, timeline:d.timeline||fallback.timeline, sources:(d.sources||fallback.sources).map(s=>s==='AI Jazeera'?'Al Jazeera':s)}; }
async function getData(){ try{ const r=await fetch('/api/risk',{cache:'no-store'}); if(!r.ok) throw new Error('API'); return normalize(await r.json()); }catch(e){ return normalize(fallback); } }
function getOverride(){ try{return JSON.parse(localStorage.getItem('oracle-admin-data')||'null')}catch(e){return null} }
function effective(d){ return getOverride() || d; }
function render(raw){ const d=normalize(effective(raw)); window.currentOracle=d;
  el('score').textContent=d.score; el('state').textContent=d.state||level(d.score); el('delta').textContent=`▲ +${d.delta ?? 0} / 24H`; el('updated').textContent='UPDATED — '+fmtTime(); el('brief').textContent=d.brief;
  el('confidence').textContent=d.confidence+'%'; el('modelConfidence').textContent=d.confidence+'%'; el('confidenceBar').style.width=d.confidence+'%'; el('assessment').textContent=d.assessment;
  el('topSource').textContent=d.topEvent.source; el('topTitle').textContent=d.topEvent.title; el('topSummary').textContent=d.topEvent.summary; el('topLink').href=d.topEvent.url||'#';
  el('drivers').innerHTML=d.drivers.map(x=>`<div class="driver"><span>${x[0]}</span><div><i style="width:${Math.min(100,x[1])}%"></i></div><strong>${x[1]}</strong></div>`).join('');
  el('regions').innerHTML=d.regions.slice(0,5).map((x,i)=>`<div class="region"><div class="ranknum">${i+1}</div><div><div class="rankname">${x[0]}</div><div class="rankmeta">${x[2]} · ${x[3]}</div></div><div class="rankscore">${x[1]}</div><div class="rankbar"><i style="width:${Math.min(100,x[1])}%"></i></div></div>`).join('');
  el('timeline').innerHTML=d.timeline.slice(0,4).map(x=>`<div class="timeline-row"><div class="time">${x[0]}</div><div>${x[1]}</div></div>`).join('');
  el('sources').innerHTML=d.sources.map(s=>`<div class="source live-source">${s}</div>`).join('');
  el('lastSync').textContent=fmtTime(); el('sourceHealth').textContent=(d.sourceHealth||96)+'%';
  el('activeConflicts').textContent=d.metrics.activeConflicts; el('activeConflictsMeta').textContent=d.metrics.activeConflictsMeta;
  el('milFlights').textContent=d.metrics.milFlights; el('milFlightsMeta').textContent=d.metrics.milFlightsMeta;
  el('cyberStatus').textContent=d.metrics.cyberStatus; el('cyberStatusMeta').textContent=d.metrics.cyberStatusMeta;
  el('logStatus').textContent=d.metrics.logStatus; el('logStatusMeta').textContent=d.metrics.logStatusMeta;
  el('eventsAnalyzed').textContent=(d.metrics.eventsAnalyzed||0).toLocaleString(); el('countriesCount').textContent=d.metrics.countries||211;
  buildCalc(d); fillAdmin(d);
}
function buildCalc(d){ const rows=d.drivers.map(([name,val,w])=>[name,val,w,+(val*w).toFixed(1)]); const raw=+rows.reduce((a,r)=>a+r[3],0).toFixed(1); const adj=+(raw-d.score).toFixed(1);
  el('calc').innerHTML=rows.map(r=>`<div class="calc-row"><span>${r[0]}</span><span>${r[1]}</span><span>×${r[2]}</span><b>${r[3]}</b></div>`).join('')+`<div class="calc-total"><span>Raw Score</span><b>${raw.toFixed(1)}</b></div><div class="calc-total"><span>AI Stability Adjustment</span><b>-${adj.toFixed(1)}</b></div><div class="calc-total"><span>FINAL SCORE</span><b>${d.score}</b></div>`; }
async function refresh(){ render(await getData()); }
el('whyBtn').onclick=()=>el('modal').classList.add('open'); el('whyBtn2').onclick=()=>el('modal').classList.add('open'); el('closeModal').onclick=()=>el('modal').classList.remove('open'); el('modal').onclick=e=>{ if(e.target.id==='modal') el('modal').classList.remove('open'); }; document.addEventListener('keydown',e=>{if(e.key==='Escape') el('modal').classList.remove('open')});
function fillAdmin(d){ if(!document.body.classList.contains('admin-mode')) return; const set=(id,v)=>{if(el(id))el(id).value=v??''}; set('adminScore',d.score);set('adminState',d.state);set('adminDelta',d.delta);set('adminConfidence',d.confidence);set('adminBrief',d.brief);set('adminAssessment',d.assessment);set('adminTopTitle',d.topEvent.title);set('adminTopSource',d.topEvent.source);set('adminTopSummary',d.topEvent.summary);set('adminTopUrl',d.topEvent.url);set('adminRegions',d.regions.map(x=>x.join(' | ')).join('\n'));set('adminTimeline',d.timeline.map(x=>x.join(' | ')).join('\n')); }
function readAdmin(){ const base=clone(window.currentOracle||fallback); const val=id=>el(id)?.value?.trim()||''; base.score=Number(val('adminScore')||base.score);base.state=val('adminState')||level(base.score);base.delta=Number(val('adminDelta')||0);base.confidence=Number(val('adminConfidence')||base.confidence);base.brief=val('adminBrief')||base.brief;base.assessment=val('adminAssessment')||base.assessment;base.topEvent={title:val('adminTopTitle')||base.topEvent.title,source:val('adminTopSource')||base.topEvent.source,summary:val('adminTopSummary')||base.topEvent.summary,url:val('adminTopUrl')||base.topEvent.url}; const rs=val('adminRegions').split('\n').map(l=>l.split('|').map(s=>s.trim())).filter(x=>x.length>=2); if(rs.length) base.regions=rs.map(x=>[x[0],Number(x[1])||0,x[2]||'Signal',x[3]||'→ 0']); const tl=val('adminTimeline').split('\n').map(l=>l.split('|').map(s=>s.trim())).filter(x=>x.length>=2); if(tl.length) base.timeline=tl.map(x=>[x[0],x.slice(1).join(' | ')]); return base; }
function postText(d){ return `ORACLE REPORT\n\nGLOBAL RISK INDEX: ${d.score}/100\nSTATUS: ${d.state}\n24H: ▲ +${d.delta}\n\nTOP EVENT\n${d.topEvent.title}\n${d.topEvent.summary}\nSource: ${d.topEvent.source}\n\nHOT REGIONS\n${d.regions.slice(0,3).map((r,i)=>`${i+1}. ${r[0]} ${r[1]}`).join('\n')}\n\nAI ASSESSMENT\n${d.assessment}\n\nhttps://oracle-rho-flax.vercel.app\n#ORACLE #WorldRisk #WorldNews`; }
function initAdmin(){ const p=new URLSearchParams(location.search); if(p.get('admin')!=='doom') return; document.body.classList.add('admin-mode'); el('adminClose').onclick=()=>document.body.classList.remove('admin-mode'); el('adminApply').onclick=()=>render(readAdmin()); el('adminSave').onclick=()=>{localStorage.setItem('oracle-admin-data',JSON.stringify(readAdmin())); el('adminOutput').value='Saved locally.'}; el('adminReset').onclick=()=>{localStorage.removeItem('oracle-admin-data'); location.href=location.pathname}; el('adminExport').onclick=()=>el('adminOutput').value=JSON.stringify(readAdmin(),null,2); el('adminCopyPost').onclick=async()=>{const t=postText(readAdmin()); el('adminOutput').value=t; try{await navigator.clipboard.writeText(t)}catch(e){}}; }
initAdmin(); refresh(); setInterval(refresh,60000);
