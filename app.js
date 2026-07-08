const $ = (id) => document.getElementById(id);
const FALLBACK = {
  ok:false, sourceHealth:72, integrity:'FALLBACK', score:38, previousScore:36, state:'WATCH', confidence:84,
  brief:'Regional tensions remain elevated. Global escalation risk remains contained.',
  assessment:'Current global risk remains stable despite concentrated military activity in East Asia. Escalation signals remain limited.',
  topEvent:{title:'Taiwan Strait', source:'GDELT', summary:'Military activity increased around the region. No immediate global escalation signal detected.', url:'https://www.gdeltproject.org/'},
  drivers:{Military:78,Diplomatic:42,Cyber:31,Logistics:18,Finance:12,Disaster:0},
  weights:{Military:.35,Diplomatic:.20,Cyber:.15,Logistics:.15,Finance:.10,Disaster:.05},
  containment:6.3,
  regions:[['Taiwan Strait',64,'Military activity · ▲ +2'],['Ukraine',59,'Active conflict · ▲ +1'],['Middle East',56,'Diplomatic pressure · → 0'],['South China Sea',48,'Maritime tension · ▲ +1'],['Korea',42,'Watch level · ▼ 1']],
  timeline:[['14:20','Military aviation activity remains elevated around East Asia.'],['13:10','Regional statements indicate continued diplomatic friction.'],['11:50','No broad global escalation signal detected across monitored sources.'],['09:30','Logistics and market stress remain contained.']],
  sources:['Reuters','AP','BBC','NHK','Al Jazeera','GDELT','USGS','NASA','MarineTraffic','FlightRadar24'],
  statusCards:[['ACTIVE CONFLICTS','7','ACTIVE','Monitored'],['MILITARY FLIGHTS','Elevated','HIGH','East Asia'],['CYBER ALERTS','Watch','LOW','No global surge'],['LOGISTICS','Stable','NORMAL','Contained']]
};
let currentData = FALLBACK;
let lastSync = new Date();
function jst(date=new Date()){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)+' JST'}
function hhmm(date=new Date()){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}).format(date)+' JST'}
function scoreState(score){ if(score>=80)return 'CRITICAL'; if(score>=65)return 'HIGH'; if(score>=50)return 'ALERT'; if(score>=30)return 'WATCH'; return 'STABLE'; }
function render(data){
  currentData=data; lastSync=new Date();
  $('score').textContent=data.score;
  $('state').textContent=data.state || scoreState(data.score);
  const delta=data.score-(data.previousScore??data.score); $('delta').textContent=`${delta>=0?'▲':'▼'} ${delta>=0?'+':''}${delta} / 24H`;
  $('updated').textContent=`UPDATED — ${hhmm(lastSync)}`; $('lastSync').textContent=jst(lastSync);
  $('sourceHealth').textContent=(data.sourceHealth??100)+'%'; $('integrity').textContent=data.integrity || (data.ok?'VERIFIED':'FALLBACK');
  $('brief').textContent=data.brief; $('confidence').textContent=data.confidence+'%'; $('confidenceBar').style.width=data.confidence+'%'; $('assessment').textContent=data.assessment;
  $('topSource').textContent=data.topEvent.source; $('topTitle').textContent=data.topEvent.title; $('topSummary').textContent=data.topEvent.summary; $('topLink').href=data.topEvent.url || '#';
  $('drivers').innerHTML=Object.entries(data.drivers).map(([k,v])=>`<div class="driver"><span>${k}</span><div><i style="width:${v}%"></i></div><strong>${v}</strong></div>`).join('');
  $('regions').innerHTML=data.regions.map((r,i)=>`<div class="region"><div class="region-num">${i+1}</div><div><div class="region-name">${r[0]}</div><div class="region-meta">${r[2]}</div></div><div class="region-score">${r[1]}</div><div class="regionbar"><i style="width:${Math.min(100,r[1])}%"></i></div></div>`).join('');
  $('timeline').innerHTML=data.timeline.map(t=>`<div class="timeline-item"><div class="timeline-time">${t[0]}</div><div class="timeline-text">${t[1]}</div></div>`).join('');
  $('sources').innerHTML=data.sources.map(s=>`<b>${s}</b>`).join('');
  $('statusCards').innerHTML=data.statusCards.map(c=>`<div class="mini"><span>${c[0]}</span><strong>${c[1]}</strong><b>${c[2]}</b><em>${c[3]}</em></div>`).join('');
  renderCalc(data);
  const post=`ORACLE / World Risk Intelligence\nGlobal Risk Index: ${data.score} (${data.state})\n${data.brief}\nTop Event: ${data.topEvent.title} — ${data.topEvent.source}\nConfidence: ${data.confidence}%\nUpdated: ${jst(lastSync)}\n#ORACLE #WorldRisk #Geopolitics`;
  $('adminOutput').value=post;
}
function renderCalc(data){
  const rows=Object.entries(data.drivers).map(([k,v])=>{const w=data.weights[k]??0;return {k,v,w,pts:v*w};});
  $('calcRows').innerHTML=rows.map(r=>`<div class="calc-row"><span>${r.k} ${r.v} × ${r.w.toFixed(2)}</span><b>${r.pts.toFixed(1)}</b></div>`).join('');
  const raw=rows.reduce((a,r)=>a+r.pts,0); $('rawScore').textContent=raw.toFixed(1); $('containment').textContent='−'+(data.containment??0).toFixed(1); $('finalScore').textContent=data.score;
}
async function refresh(){
  try{ const r=await fetch('/api/risk?ts='+Date.now(),{cache:'no-store'}); if(!r.ok)throw new Error('api'); const data=await r.json(); render({...FALLBACK,...data}); }
  catch(e){ render({...FALLBACK, integrity:'FALLBACK', sourceHealth:72}); }
}
$('whyBtn').addEventListener('click',()=>{$('scoreModal').classList.add('open');$('scoreModal').setAttribute('aria-hidden','false')});
$('closeModal').addEventListener('click',()=>{$('scoreModal').classList.remove('open')});
$('scoreModal').addEventListener('click',(e)=>{if(e.target.id==='scoreModal')$('scoreModal').classList.remove('open')});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape')$('scoreModal').classList.remove('open')});
$('copyPost')?.addEventListener('click',()=>navigator.clipboard.writeText($('adminOutput').value));
$('copyJson')?.addEventListener('click',()=>navigator.clipboard.writeText(JSON.stringify(currentData,null,2)));
$('forceRefresh')?.addEventListener('click',refresh);
if(new URLSearchParams(location.search).get('admin')==='doom') $('adminPanel').classList.add('open');
refresh(); setInterval(refresh,60000);
