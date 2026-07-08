export default function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
  res.status(200).json({ok:true,global:38,level:'WATCH',updated:new Date().toISOString()});
}
