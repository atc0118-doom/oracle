
const now = new Date();

export default function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  res.status(200).json({
    ok:true,
    global:38,
    level:'WATCH',
    delta:'+2 / 24H',
    confidence:84,
    updated:now.toISOString(),
    brief:'Regional tensions remain elevated. Global escalation risk remains contained.',
    assessment:'Current global risk remains stable despite concentrated military activity in East Asia. Escalation signals remain limited.',
    basis:{
      score:'38 / 100',
      text:'Index combines public reporting signals, regional concentration, escalation language and disruption indicators. It is an intelligence-style estimate, not a prediction.'
    },
    event:{
      source:'Reuters',
      title:'Taiwan Strait',
      text:'Military activity increased around the region. No immediate global escalation signal detected.',
      url:'https://www.reuters.com/world/'
    },
    drivers:[
      {name:'Military', value:78, note:'Concentrated activity near East Asia and Eastern Europe'},
      {name:'Logistics', value:15, note:'No broad disruption signal detected'},
      {name:'Political', value:7, note:'Diplomatic friction remains present but contained'}
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
    sources:['Reuters','AP','BBC','NHK','GDELT','USGS']
  });
}
