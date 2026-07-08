
const fallbackData = {
  ok:true,
  global:38,
  level:'WATCH',
  delta:'+2 / 24H',
  confidence:84,
  brief:'Regional tensions remain elevated. Global escalation risk remains contained.',
  assessment:'Current global risk remains stable despite concentrated military activity in East Asia. Escalation signals remain limited.',
  event:{source:'Reuters', title:'Taiwan Strait', text:'Military activity increased around the region. No immediate global escalation signal detected.', url:'https://www.reuters.com/world/'},
  drivers:[
    {name:'Military', value:78, note:'regional activity'},
    {name:'Logistics', value:15, note:'limited disruption'},
    {name:'Political', value:7, note:'diplomatic friction'}
  ],
  ranking:[
    {name:'Ukraine', score:72, change:'+4', reason:'active war / air alerts'},
    {name:'Taiwan', score:68, change:'+2', reason:'military pressure'},
    {name:'Iran', score:64, change:'0', reason:'regional tension'},
    {name:'Russia', score:61, change:'-1', reason:'security posture'},
    {name:'Israel', score:57, change:'+1', reason:'regional conflict'}
  ],
  signals:[
    {label:'Active Conflicts', value:'7', detail:'Monitored'},
    {label:'Military Flights', value:'Elevated', detail:'East Asia'},
    {label:'Cyber Alerts', value:'Watch', detail:'No global surge'},
    {label:'Logistics', value:'Stable', detail:'Contained'}
  ],
  basis:{score:'38 / 100', text:'Index combines public reporting signals, regional concentration, escalation language and disruption indicators. It is an intelligence-style estimate, not a prediction.'}
};

let currentData = fallbackData;
function $(id){return document.getElementById(id)}
function pad(n){return String(n).padStart(2,'0')}
function updateTime(iso){
  const d = iso ? new Date(iso) : new Date();
  $('updated').textContent = `UPDATED — ${pad(d.getHours())}:${pad(d.getMinutes())} JST`;
}
function arrow(change){
  if(change === '0' || change === 0) return '→ 0';
  const s = String(change);
  return s.startsWith('-') ? `▼ ${s.replace('-','')}` : `▲ ${s.replace('+','')}`;
}
function renderRanking(list){
  const root = $('ranking');
  if(!root) return;
  root.innerHTML = (list||[]).slice(0,5).map((r,i)=>`
    <div class="rank">
      <div class="ranknum">${i+1}</div>
      <div>
        <div class="rankname">${r.name}</div>
        <div class="rankmeta">${arrow(r.change)} · ${r.reason||'observed risk'}</div>
      </div>
      <div class="rankscore">${r.score}</div>
      <div class="rankbar"><i style="width:${Math.max(0,Math.min(100,r.score))}%"></i></div>
    </div>`).join('');
}
function renderDrivers(list, delta){
  const root = $('drivers');
  if(!root) return;
  $('driverTotal').textContent = delta || '+0 / 24H';
  root.innerHTML = (list||[]).map(d=>`
    <div class="driver" title="${d.note||''}">
      <span>${d.name}</span><div><i style="width:${Math.max(0,Math.min(100,d.value))}%"></i></div><strong>${d.value}%</strong>
    </div>`).join('');
}
function renderSignals(list){
  const root = $('signals');
  if(!root) return;
  root.innerHTML = (list||[]).map(s=>`
    <div class="signal"><span>${s.label}</span><strong>${s.value}</strong><em>${s.detail}</em></div>`).join('');
}
function render(data){
  currentData = data || fallbackData;
  $('score').textContent = currentData.global;
  $('state').textContent = currentData.level;
  $('delta').textContent = `▲ ${currentData.delta}`.replace('▲ +','▲ +');
  $('brief').textContent = currentData.brief;
  $('assessment').textContent = currentData.assessment;
  $('confidence').textContent = `${currentData.confidence||84}%`;
  const bar = document.querySelector('.confidence-bar i');
  if(bar) bar.style.width = `${currentData.confidence||84}%`;
  $('eventSource').textContent = currentData.event.source;
  $('eventTitle').textContent = currentData.event.title;
  $('eventText').textContent = currentData.event.text;
  $('eventLink').href = currentData.event.url || '#';
  $('basisScore').textContent = currentData.basis?.score || `${currentData.global} / 100`;
  $('basisText').textContent = currentData.basis?.text || fallbackData.basis.text;
  updateTime(currentData.updated);
  renderDrivers(currentData.drivers, currentData.delta);
  renderRanking(currentData.ranking);
  renderSignals(currentData.signals);
}
async function loadRisk(){
  try{
    const res = await fetch('/api/risk', {cache:'no-store'});
    if(!res.ok) throw new Error('risk api failed');
    const data = await res.json();
    render(data);
  }catch(e){
    render(fallbackData);
  }
}
function makePost(type){
  const d = currentData;
  const top = `${d.event.title} / ${d.event.source}`;
  const drivers = (d.drivers||[]).map(x=>`${x.name} ${x.value}%`).join('・');
  const templates = {
    morning:`【ORACLE Morning】\nGlobal Risk Index: ${d.global} / ${d.level}\n${d.brief}\nTop Event: ${top}\n#ORACLE #WorldRisk #Geopolitics`,
    noon:`【ORACLE Midday】\n${d.assessment}\nRisk Drivers: ${drivers}\n#ORACLE #WorldRisk #Intelligence`,
    night:`【ORACLE Night Report】\nGlobal Risk Index: ${d.global} (${d.delta})\n${d.brief}\nSources: Reuters / AP / BBC / NHK / GDELT / USGS\n#ORACLE #WorldRisk`,
    alert:`【ORACLE Alert】\n${d.level}: ${d.global}\nTop Event: ${top}\n${d.event.text}\n#ORACLE #RiskAlert`
  };
  $('postText').value = templates[type] || templates.morning;
}
async function copyPost(){
  const t = $('postText');
  t.select();
  try{await navigator.clipboard.writeText(t.value)}catch(e){document.execCommand('copy')}
}
function initAdmin(){
  if(new URLSearchParams(location.search).get('admin')==='doom') $('adminPanel')?.classList.add('open');
}
loadRisk(); initAdmin(); setInterval(()=>updateTime(currentData.updated),60000);
