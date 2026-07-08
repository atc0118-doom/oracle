export default function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=300');
  res.status(200).json({ok:true,global:38,state:'WATCH',delta:'+2',updated:new Date().toISOString()});
}
