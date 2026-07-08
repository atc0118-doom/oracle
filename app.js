const DATA={
  global:38, delta:'+2', level:'WATCH', confidence:84,
  brief:'Regional tensions remain elevated. Global escalation risk remains contained.',
  assessment:'Current global risk remains stable despite concentrated military activity in East Asia. Escalation signals remain limited.',
  event:{title:'Taiwan Strait',source:'Reuters',text:'Military activity increased around the region. No immediate global escalation signal detected.',url:'#'},
  drivers:[['Military',78],['Logistics',15],['Political',7]],
  ranking:[['Ukraine',72,'+4'],['Taiwan',68,'+2'],['Iran',64,'0'],['Russia',61,'-1'],['Israel',57,'+1']]
};
function $(id){return document.getElementById(id)}
function render(data){
  $('score').textContent=data.global;
  $('state').textContent=data.level;
  $('delta').textContent=`▲ ${data.delta} / 24H`;
  $('updated').textContent=`UPDATED — ${new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})} JST`;
  $('brief').textContent=data.brief;
  $('confidence').textContent=data.confidence+'%';
  $('confidenceFill').style.width=data.confidence+'%';
  $('assessment').textContent=data.assessment;
  $('eventSource').textContent=data.event.source;
  $('eventTitle').textContent=data.event.title;
  $('eventText').textContent=data.event.text;
  $('eventLink').href=data.event.url;
  $('drivers').innerHTML=data.drivers.map(([name,val])=>`<div class="driver"><span>${name}</span><div><i style="width:${val}%"></i></div><strong>${val}%</strong></div>`).join('');
  $('ranking').innerHTML=data.ranking.map(([name,score,change],i)=>`<div class="rank"><div class="ranknum">${String(i+1).padStart(2,'0')}</div><div><div class="rankname">${name}</div><div class="rankmeta">${change==='0'?'→ 0':(change.startsWith('-')?'▼ ':'▲ ')+change.replace('-','')}</div></div><div class="rankscore">${score}</div><div class="rankbar"><i style="width:${score}%"></i></div></div>`).join('');
}
function makePost(type){
  const t={morning:'Morning Brief',noon:'Midday Watch',night:'Night Report',alert:'Risk Alert'}[type]||'ORACLE Brief';
  $('postText').value=`${t}\n\nGLOBAL RISK INDEX ${DATA.global} / ${DATA.level}\n${DATA.brief}\n\nTop Event: ${DATA.event.title}\nAI: ${DATA.assessment}\n\n#ORACLE #WorldRisk #世界情勢`;
}
async function copyPost(){await navigator.clipboard.writeText($('postText').value||'');}
render(DATA);
if(new URLSearchParams(location.search).get('admin')==='doom') $('admin').classList.add('open');
