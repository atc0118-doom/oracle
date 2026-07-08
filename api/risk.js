export default function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  res.status(200).json({
    ok:true,
    global:38,
    level:'WATCH',
    delta:'+2 / 24H',
    updated:new Date().toISOString(),
    assessment:'Current global risk remains stable despite concentrated military activity in East Asia. Escalation signals remain limited.',
    event:{source:'Reuters', title:'Taiwan Strait', text:'Military activity increased around the region. No immediate global escalation signal detected.'},
    ranking:[
      {name:'Ukraine',score:72,change:'+4'},
      {name:'Taiwan',score:68,change:'+2'},
      {name:'Iran',score:64,change:'0'},
      {name:'Russia',score:61,change:'-1'},
      {name:'Israel',score:57,change:'+1'}
    ]
  });
}
