const data = {
  global:38,
  state:'WATCH',
  delta:'+2',
  confidence:84,
  ranking:[
    {name:'Ukraine',score:72,change:'+4'},
    {name:'Taiwan',score:68,change:'+2'},
    {name:'Iran',score:64,change:'0'},
    {name:'Russia',score:61,change:'-1'},
    {name:'Israel',score:57,change:'+1'}
  ]
};
function $(id){return document.getElementById(id)}
function timeJST(){return new Date().toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'})}
function render(){
  $('score').textContent=data.global;
  $('state').textContent=data.state;
  $('delta').textContent=`▲ ${data.delta} / 24H`;
  $('updated').textContent=`UPDATED — ${timeJST()} JST`;
  $('confidence').textContent=`${data.confidence}%`;
  $('ranking').innerHTML=data.ranking.map(r=>{
    const cls=r.change.startsWith('-')?'down':r.change==='0'?'':'up';
    const mark=r.change.startsWith('-')?'▼':r.change==='0'?'→':'▲';
    return `<div class="rank"><div class="rankname">${r.name}</div><div class="rankscore">${r.score}</div><div class="rankchange ${cls}">${mark} ${r.change}</div><div class="rankbar"><i style="width:${r.score}%"></i></div></div>`
  }).join('');
  if(new URLSearchParams(location.search).get('admin')==='doom') $('admin').classList.add('open');
}
function makePost(type){
  const base=`ORACLE / World Risk Intelligence\n\nGlobal Risk Index: ${data.global}\nStatus: ${data.state}\n24H: ${data.delta}\n\nRegional military tension remains elevated. No immediate global escalation detected.\n\nTop Risk: ${data.ranking[0].name} ${data.ranking[0].score}\n\n#ORACLE #WorldRisk #世界情勢 #終末観測盤`;
  $('postText').value=base;
}
async function copyPost(){
  const t=$('postText').value;
  try{await navigator.clipboard.writeText(t);$('postText').value=t+'\n\nCopied.'}catch(e){}
}
render();
