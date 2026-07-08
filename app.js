const $ = (id) => document.getElementById(id);
const now = new Date();
$('updated').textContent = now.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}) + ' JST';
const params = new URLSearchParams(location.search);
if(params.get('admin') === 'doom') $('adminPanel').classList.add('open');
window.makePost = function(type){
  const templates = {
    morning:`ORACLE / Morning Brief\n\nGlobal Risk Index: 38 / WATCH\nPrimary concern: Taiwan Strait\nConfidence: 84%\n\n世界情勢は局地的緊張が継続。急激な世界規模拡大の兆候は限定的。\n\n#ORACLE #WorldRisk #Geopolitics #世界情勢`,
    noon:`ORACLE / Midday Update\n\nGlobal Risk Index remains at 38.\nKey drivers: Military 78%, Logistics 15%, Political 7%.\n\n#ORACLE #WorldRisk #国際ニュース`,
    night:`ORACLE / Daily Close\n\nGlobal Risk Index: 38 / WATCH\nNo immediate global escalation signal detected.\n\n#ORACLE #WorldRisk #Geopolitics`
  };
  $('postText').value = templates[type] || templates.morning;
}
window.copyPost = async function(){
  const text = $('postText').value;
  await navigator.clipboard.writeText(text);
  alert('Copied');
}
