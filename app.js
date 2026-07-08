const ranking = [
  {name:'Ukraine', score:72, change:'+4'},
  {name:'Taiwan', score:68, change:'+2'},
  {name:'Iran', score:64, change:'0'},
  {name:'Russia', score:61, change:'-1'},
  {name:'Israel', score:57, change:'+1'}
];

function $(id){return document.getElementById(id)}
function pad(n){return String(n).padStart(2,'0')}
function updateTime(){
  const d = new Date();
  $('updated').textContent = `UPDATED — ${pad(d.getHours())}:${pad(d.getMinutes())} JST`;
}
function renderRanking(){
  const root = $('ranking');
  if(!root) return;
  root.innerHTML = ranking.map((r,i)=>`
    <div class="rank">
      <div class="ranknum">${i+1}</div>
      <div>
        <div class="rankname">${r.name}</div>
        <div class="rankmeta">${r.change==='0'?'→ 0':(r.change.startsWith('-')?'▼ ':'▲ ')+r.change.replace('-','')}</div>
      </div>
      <div class="rankscore">${r.score}</div>
      <div class="rankbar"><i style="width:${r.score}%"></i></div>
    </div>`).join('');
}
function makePost(type){
  const templates = {
    morning:'【ORACLE Morning】\nGlobal Risk Index: 38 / WATCH\nRegional tensions remain elevated. Global escalation risk remains contained.\n#ORACLE #WorldRisk #Geopolitics',
    noon:'【ORACLE Midday】\nGlobal risk remains stable at WATCH level. Primary pressure remains concentrated in East Asia.\n#ORACLE #WorldRisk #Intelligence',
    night:'【ORACLE Night Report】\nRisk drivers: Military 78%, Logistics 15%, Political 7%. No immediate global escalation signal detected.\n#ORACLE #WorldRisk',
    alert:'【ORACLE Alert】\nRisk level requires attention. Check latest regional signals and source updates.\n#ORACLE #RiskAlert'
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
updateTime(); renderRanking(); initAdmin(); setInterval(updateTime,60000);
