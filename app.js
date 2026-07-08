const ranking = [
  {name:'Taiwan Strait', score:64, change:'+2', note:'Military activity'},
  {name:'Ukraine', score:59, change:'+1', note:'Active conflict'},
  {name:'Middle East', score:56, change:'0', note:'Diplomatic pressure'},
  {name:'South China Sea', score:48, change:'+1', note:'Maritime tension'},
  {name:'Korea', score:42, change:'-1', note:'Watch level'}
];

const timeline = [
  {time:'14:20', text:'Military aviation activity remains elevated around East Asia.'},
  {time:'13:10', text:'Regional statements indicate continued diplomatic friction.'},
  {time:'11:50', text:'No broad global escalation signal detected across monitored sources.'},
  {time:'09:30', text:'Logistics and market stress remain contained.'}
];

function $(id){return document.getElementById(id)}
function pad(n){return String(n).padStart(2,'0')}
function updateTime(){
  const d = new Date();
  const el = $('updated');
  if(el) el.textContent = `UPDATED — ${pad(d.getHours())}:${pad(d.getMinutes())} JST`;
}
function renderRanking(){
  const root = $('ranking');
  if(!root) return;
  root.innerHTML = ranking.map((r,i)=>`
    <div class="rank">
      <div class="ranknum">${i+1}</div>
      <div>
        <div class="rankname">${r.name}</div>
        <div class="rankmeta">${r.note} · ${r.change==='0'?'→ 0':(r.change.startsWith('-')?'▼ ':'▲ ')+r.change.replace('-','')}</div>
      </div>
      <div class="rankscore">${r.score}</div>
      <div class="rankbar"><i style="width:${r.score}%"></i></div>
    </div>`).join('');
}
function renderTimeline(){
  const root = $('timeline');
  if(!root) return;
  root.innerHTML = timeline.map(t=>`
    <div class="timeline-item">
      <div class="timeline-time">${t.time}</div>
      <div class="timeline-text">${t.text}</div>
    </div>`).join('');
}
function makePost(type){
  const templates = {
    morning:'【ORACLE Morning】\nGlobal Risk Index: 38 / WATCH\nTop event: Taiwan Strait. Regional tensions remain elevated, while global escalation risk remains contained.\n#ORACLE #WorldRisk #Geopolitics',
    noon:'【ORACLE Midday】\nRisk drivers: Military 78 / Diplomatic 42 / Cyber 31 / Logistics 18 / Finance 12.\nPrimary pressure remains concentrated in East Asia.\n#ORACLE #WorldRisk #Intelligence',
    night:'【ORACLE Night Report】\nHot regions: Taiwan Strait, Ukraine, Middle East, South China Sea, Korea.\nNo immediate global escalation signal detected.\n#ORACLE #WorldRisk',
    alert:'【ORACLE Alert】\nRisk level requires attention. Check latest regional signals, source updates, and 24H timeline.\n#ORACLE #RiskAlert'
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
updateTime(); renderRanking(); renderTimeline(); initAdmin(); setInterval(updateTime,60000);
