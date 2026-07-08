const fallback={score:38,state:'WATCH',delta:'+2 / 24H',brief:'Regional tensions remain elevated. Global escalation risk remains contained.',confidence:84,assessment:'Current global risk remains stable despite concentrated military activity in East Asia. Escalation signals remain limited.',topEvent:{title:'Taiwan Strait',source:'Reuters',summary:'Military activity increased around the region. No immediate global escalation signal detected.',url:'https://www.reuters.com/'},drivers:[['Military',78],['Diplomatic',42],['Cyber',31],['Logistics',18],['Finance',12]],regions:[['Taiwan Strait',64,'Military activity · ▲ +2'],['Ukraine',59,'Active conflict · ▲ +1'],['Middle East',56,'Diplomatic pressure · → 0'],['South China Sea',48,'Maritime tension · ▲ +1'],['Korea',42,'Watch level · ▼ 1']],timeline:[['14:20','Military aviation activity remains elevated around East Asia.'],['13:10','Regional statements indicate continued diplomatic friction.'],['11:50','No broad global escalation signal detected across monitored sources.'],['09:30','Logistics and market stress remain contained.']],sources:['Reuters','AP','BBC','NHK','Al Jazeera','GDELT','USGS','NASA','MarineTraffic','FlightRadar24'],signals:[['ACTIVE CONFLICTS','7','Monitored','ACTIVE'],['MILITARY FLIGHTS','Elevated','East Asia','HIGH'],['CYBER ALERTS','Watch','No global surge','LOW'],['LOGISTICS','Stable','Contained','NORMAL']]};
let current=fallback;
function $(id){return document.getElementById(id)}
function jst(){return new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'})}
function jstFull(){return new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Tokyo'})}
function animateScore(next){const el=$('score');const start=Number(el.textContent)||next;const diff=next-start;let t=0;const timer=setInterval(()=>{t+=1;el.textContent=Math.round(start+diff*(t/12));if(t>=12){el.textContent=next;clearInterval(timer)}},24)}
function render(data){current=data;animateScore(Number(data.score||38));$('state').textContent=data.state||'WATCH';$('delta').textContent='▲ '+(data.delta||'+2 / 24H');$('updated').textContent='UPDATED — '+jst()+' JST';$('brief').textContent=data.brief;$('confidence').textContent=data.confidence+'%';$('confidenceBar').style.width=data.confidence+'%';$('assessment').textContent=data.assessment;$('topTitle').textContent=data.topEvent.title;$('topSource').textContent=data.topEvent.source;$('topSummary').textContent=data.topEvent.summary;$('topLink').href=data.topEvent.url;
$('drivers').innerHTML=data.drivers.map(d=>`<div class="driver"><span>${d[0]}</span><div><i style="width:${d[1]}%"></i></div><strong>${d[1]}</strong></div>`).join('');
$('regions').innerHTML=data.regions.map((r,i)=>`<div class="region"><div class="region-no">${i+1}</div><div><div class="region-name">${r[0]}</div><div class="region-meta">${r[2]}</div></div><div class="region-score">${r[1]}</div><div class="rankbar"><i style="width:${r[1]}%"></i></div></div>`).join('');
$('timeline').innerHTML=data.timeline.map(t=>`<div class="time-row"><b>${t[0]}</b><span>${t[1]}</span></div>`).join('');
$('sources').innerHTML=data.sources.map(s=>`<b>${s}</b>`).join('');
$('signals').innerHTML=data.signals.map(s=>`<div class="mini"><span>${s[0]}</span><b>${s[1]}</b><small>${s[2]}</small><em>STATUS ${s[3]||'NORMAL'}</em></div>`).join(''); const full=jstFull(); if($('lastSync')) $('lastSync').textContent=full+' JST'; if($('footerSync')) $('footerSync').textContent='Last system update: '+full+' JST';}
async function load(){try{const res=await fetch('/api/risk.js?ts='+Date.now(),{cache:'no-store'}); const text=await res.text(); if(text.trim().startsWith('{')) render(JSON.parse(text)); else render(fallback);}catch(e){render(fallback)}}
function makePost(type){const top=current.topEvent; const base=`【ORACLE / ${type.toUpperCase()}】\n\nGlobal Risk Index: ${current.score} / ${current.state}\n${current.brief}\n\nTop Event: ${top.title}\nSource: ${top.source}\n\nRisk Drivers:\n${current.drivers.map(d=>`- ${d[0]} ${d[1]}`).join('\n')}\n\n#ORACLE #WorldRisk #Geopolitics #RiskIntelligence`; $('postText').value=base}
async function copyPost(){const t=$('postText').value; try{await navigator.clipboard.writeText(t)}catch(e){}}
if(location.search.includes('admin=doom')){$('adminPanel').classList.add('open');makePost('day')}

function openModal(){const m=$('scoreModal'); if(m){m.classList.add('open'); m.setAttribute('aria-hidden','false'); renderCalc(current)}}
function closeModal(){const m=$('scoreModal'); if(m){m.classList.remove('open'); m.setAttribute('aria-hidden','true')}}
function renderCalc(data){
  const weights={Military:.35,Diplomatic:.20,Cyber:.15,Logistics:.15,Finance:.10,Disaster:.05};
  const rows=['Military','Diplomatic','Cyber','Logistics','Finance','Disaster'].map(name=>{
    const found=(data.drivers||[]).find(d=>d[0]===name); const val=found?Number(found[1]):0; const pts=val*(weights[name]||0);
    return {name,val,weight:weights[name]||0,pts};
  });
  const raw=rows.reduce((a,r)=>a+r.pts,0); const final=Number(data.score||38); const containment=final-raw;
  if($('calcList')) $('calcList').innerHTML=rows.map(r=>`<div class="calc-row"><span>${r.name}</span><small>${r.val} × ${r.weight.toFixed(2)}</small><b>${r.pts.toFixed(1)}</b></div>`).join('');
  if($('rawScore')) $('rawScore').textContent=raw.toFixed(1);
  if($('containmentScore')) $('containmentScore').textContent=(containment<0?'−':'')+Math.abs(containment).toFixed(1);
  if($('finalScore')) $('finalScore').textContent=final;
}
if($('whyScore')) $('whyScore').addEventListener('click',openModal);
document.addEventListener('click',e=>{if(e.target && e.target.dataset && e.target.dataset.close==='scoreModal') closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape') closeModal()});

load();setInterval(load,60000);setInterval(()=>{const full=jstFull(); $('updated').textContent='UPDATED — '+jst()+' JST'; if($('lastSync')) $('lastSync').textContent=full+' JST'; if($('footerSync')) $('footerSync').textContent='Last system update: '+full+' JST'},30000);
