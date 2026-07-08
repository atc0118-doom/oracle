export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=900, stale-while-revalidate=1800');
  res.status(200).json({
    ok:true,
    global:38,
    status:'WATCH',
    delta:'+2 / 24H',
    confidence:84,
    brief:'Regional tensions remain elevated. Global escalation risk remains contained.',
    assessment:'Current global risk remains stable despite concentrated military activity in East Asia. Escalation signals remain limited.',
    topEvent:{
      region:'Taiwan Strait',
      source:'Reuters',
      text:'Military activity increased around the region. No immediate global escalation signal detected.',
      url:'https://www.reuters.com/world/'
    },
    drivers:{military:78,diplomatic:42,cyber:31,logistics:18,finance:12},
    regions:[
      {name:'Taiwan Strait',score:64,change:'+2',note:'Military activity'},
      {name:'Ukraine',score:59,change:'+1',note:'Active conflict'},
      {name:'Middle East',score:56,change:'0',note:'Diplomatic pressure'},
      {name:'South China Sea',score:48,change:'+1',note:'Maritime tension'},
      {name:'Korea',score:42,change:'-1',note:'Watch level'}
    ],
    timeline:[
      {time:'14:20', text:'Military aviation activity remains elevated around East Asia.'},
      {time:'13:10', text:'Regional statements indicate continued diplomatic friction.'},
      {time:'11:50', text:'No broad global escalation signal detected across monitored sources.'},
      {time:'09:30', text:'Logistics and market stress remain contained.'}
    ],
    sources:['Reuters','AP','BBC','NHK','Al Jazeera','GDELT','USGS','NASA']
  });
}
