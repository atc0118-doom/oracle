const REGION_KEYWORDS = [
  { name: 'Ukraine', terms: ['ukraine','kyiv','kiev','donetsk','kharkiv','zaporizhzhia','russia'] },
  { name: 'Taiwan Strait', terms: ['taiwan','taipei','strait','pla','china military'] },
  { name: 'Middle East', terms: ['iran','israel','gaza','hamas','hezbollah','red sea','houthi','lebanon','syria'] },
  { name: 'South China Sea', terms: ['south china sea','philippines','spratly','scarborough'] },
  { name: 'Korea', terms: ['north korea','south korea','pyongyang','seoul'] },
  { name: 'US / NATO', terms: ['nato','united states','pentagon','washington'] }
];
const CATEGORY_KEYWORDS = {
  Military: ['military','missile','drone','airstrike','troops','army','navy','air force','attack','defense','war','combat','shelling','weapon'],
  Diplomatic: ['sanction','summit','ceasefire','negotiation','treaty','diplomatic','minister','embassy','un','resolution','talks'],
  Cyber: ['cyber','hack','malware','ransomware','data breach','ddos','spyware'],
  Logistics: ['shipping','port','tanker','supply chain','freight','container','canal','sea lane','logistics'],
  Finance: ['market','oil','gas','inflation','stocks','bond','currency','rate','bank'],
  Disaster: ['earthquake','flood','wildfire','volcano','storm','hurricane','typhoon','tsunami','drought']
};
const WEIGHTS = { Military:.35, Diplomatic:.20, Cyber:.15, Logistics:.15, Finance:.10, Disaster:.05 };

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=240');
  try{
    const articles = await fetchGdelt();
    const analyzed = analyzeArticles(articles);
    const llm = await maybeLLM(analyzed, articles);
    const payload = buildPayload(analyzed, articles, llm);
    res.status(200).json(payload);
  }catch(error){
    const payload = fallbackPayload(error?.message || 'unknown');
    res.status(200).json(payload);
  }
}
async function fetchGdelt(){
  const query = encodeURIComponent('(military OR conflict OR missile OR drone OR cyber OR earthquake OR logistics OR shipping OR sanctions OR Taiwan OR Ukraine OR Iran OR Israel)');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=75&sort=hybridrel&timespan=24h`;
  const r = await fetch(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence' } });
  if(!r.ok) throw new Error('gdelt ' + r.status);
  const j = await r.json();
  return (j.articles || []).map(a=>({
    title: clean(a.title),
    url: a.url,
    source: sourceName(a.sourceCountry, a.domain),
    domain: a.domain || '',
    seen: a.seendate || '',
    language: a.language || ''
  })).filter(a=>a.title && a.url).slice(0,60);
}
function clean(s=''){ return String(s).replace(/\s+/g,' ').trim(); }
function sourceName(country, domain){
  if(!domain) return 'GDELT';
  const d = domain.replace(/^www\./,'');
  if(d.includes('reuters')) return 'Reuters';
  if(d.includes('apnews')) return 'AP';
  if(d.includes('bbc')) return 'BBC';
  if(d.includes('nhk')) return 'NHK';
  if(d.includes('aljazeera')) return 'Al Jazeera';
  return d.split('.')[0].slice(0,16);
}
function countTerms(text, terms){ return terms.reduce((n,t)=> n + (text.includes(t) ? 1 : 0), 0); }
function analyzeArticles(articles){
  const corpus = articles.map(a=>a.title).join(' ').toLowerCase();
  const categoryCounts = {};
  Object.entries(CATEGORY_KEYWORDS).forEach(([cat, terms])=> categoryCounts[cat] = countTerms(corpus, terms));
  const total = Math.max(articles.length,1);
  const drivers = {};
  Object.entries(categoryCounts).forEach(([cat,count])=>{
    const base = cat === 'Military' ? 18 : cat === 'Diplomatic' ? 12 : 6;
    drivers[cat] = clamp(Math.round(base + (count * 9) + Math.min(total,60)*0.18), 0, 90);
  });
  const regions = REGION_KEYWORDS.map(r=>{
    const c = countTerms(corpus, r.terms);
    const score = clamp(Math.round(12 + c*13 + drivers.Military*0.22 + drivers.Diplomatic*0.08), 8, 85);
    return { name:r.name, score, change: c>2?'+2':c>0?'+1':'0', trend:c>2?'Rising':c>0?'Watch':'Stable', count:c };
  }).sort((a,b)=>b.score-a.score).slice(0,5);
  const raw = Object.entries(drivers).reduce((s,[k,v])=>s+(v*(WEIGHTS[k]||0)),0);
  const containment = containmentAdjustment(drivers, regions, total);
  const final = clamp(Math.round(raw + containment), 5, 92);
  const top = pickTopEvent(articles, regions);
  const confidence = clamp(Math.round(62 + Math.min(articles.length,60)*0.35 + (top ? 8 : 0)), 55, 93);
  return { drivers, regions, raw, containment, final, confidence, top, total };
}
function containmentAdjustment(drivers, regions, total){
  let adj = -4;
  if(drivers.Military > 65 && drivers.Diplomatic > 45) adj += 4;
  if(regions[0]?.score > 70) adj += 3;
  if(total < 12) adj -= 5;
  if(drivers.Logistics < 25 && drivers.Finance < 25) adj -= 2;
  return Math.round(adj*10)/10;
}
function pickTopEvent(articles, regions){
  if(!articles.length) return null;
  const region = regions[0]?.name?.toLowerCase() || '';
  const preferred = articles.find(a=>a.title.toLowerCase().includes(region.split(' ')[0])) || articles[0];
  return preferred;
}
async function maybeLLM(analyzed, articles){
  const key = process.env.OPENAI_API_KEY;
  if(!key) return null;
  try{
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const sample = articles.slice(0,15).map((a,i)=>`${i+1}. ${a.title} (${a.source})`).join('\n');
    const body = {
      model,
      input: `You are ORACLE, a calm world-risk intelligence system. Based on these public news headlines and calculated signals, return strict JSON with keys: assessment (max 2 sentences), brief (max 2 sentences), topSummary (max 1 sentence). No markdown. Score=${analyzed.final}; Top region=${analyzed.regions[0]?.name}; Drivers=${JSON.stringify(analyzed.drivers)}. Headlines:\n${sample}`,
      text: { format: { type: 'json_object' } }
    };
    const r = await fetch('https://api.openai.com/v1/responses', { method:'POST', headers:{ 'content-type':'application/json', authorization:`Bearer ${key}` }, body:JSON.stringify(body) });
    if(!r.ok) return null;
    const j = await r.json();
    const text = j.output_text || j.output?.flatMap(o=>o.content||[]).map(c=>c.text).join('') || '';
    return JSON.parse(text);
  }catch(e){ return null; }
}
function buildPayload(analyzed, articles, llm){
  const score = analyzed.final;
  const state = stateFromScore(score);
  const top = analyzed.top || { title:'Public signals under monitoring', source:'GDELT', url:'https://www.gdeltproject.org/' };
  const topRegion = analyzed.regions[0]?.name || 'Global';
  const drivers = analyzed.drivers;
  const timeline = articles.slice(0,5).map((a,i)=>({ time: i===0?'NOW':`-${(i+1)*12}M`, text: `${a.source}: ${a.title.slice(0,115)}` }));
  const calculation = { raw: round1(analyzed.raw), containment: round1(analyzed.containment), final: score };
  const previousScore = clamp(score - (analyzed.regions[0]?.count > 2 ? 2 : 1), 0, 100);
  return {
    ok:true,
    mode:'live',
    aiUsed: Boolean(llm),
    aiMode: llm ? 'LLM ASSISTED' : 'RULE BASED',
    updatedAt:new Date().toISOString(),
    score,
    previousScore,
    state,
    confidence: analyzed.confidence,
    sourceHealth: articles.length > 10 ? 96 : 82,
    brief: llm?.brief || `${topRegion} remains the highest monitored pressure point. Global escalation risk remains ${score >= 50 ? 'elevated' : 'contained'}.`,
    assessment: llm?.assessment || `ORACLE detected ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`,
    topEvent: { title: top.title, summary: llm?.topSummary || `${topRegion} is currently the strongest contributor to the global risk index.`, source: top.source || 'GDELT', url: top.url || 'https://www.gdeltproject.org/' },
    drivers,
    weights: WEIGHTS,
    calculation,
    regions: analyzed.regions.map(r=>({ name:r.name, score:r.score, change:r.change, trend:r.trend })),
    timeline: timeline.length ? timeline : [{time:'NOW', text:'Monitoring active.'}],
    metrics:{
      conflicts: String(Math.max(3, analyzed.regions.filter(r=>r.score>35).length + 3)), conflictsSub:'MONITORED',
      flights: drivers.Military > 55 ? 'ELEVATED' : 'WATCH', flightsSub:'PUBLIC SIGNALS',
      cyber: drivers.Cyber > 50 ? 'MEDIUM' : 'WATCH', cyberSub: drivers.Cyber > 50 ? 'SURGE DETECTED' : 'LOW SURGE',
      logistics: drivers.Logistics > 45 ? 'WATCH' : 'STABLE', logisticsSub: drivers.Logistics > 45 ? 'PRESSURE' : 'CONTAINED'
    }
  };
}
function stateFromScore(s){ if(s>=70)return'CRITICAL'; if(s>=50)return'HIGH'; if(s>=30)return'WATCH'; return'STABLE'; }
function clamp(n,min,max){ return Math.max(min, Math.min(max, Number(n)||0)); }
function round1(n){ return Math.round(Number(n||0)*10)/10; }
function fallbackPayload(error){
  return {
    ok:true, mode:'fallback', error, aiMode:'RULE BASED', updatedAt:new Date().toISOString(), score:28, previousScore:25, state:'STABLE', confidence:70, sourceHealth:72,
    brief:'Public sources are partially available. ORACLE is operating in conservative monitoring mode.',
    assessment:'Signal volume is limited. The system is maintaining a stable global risk posture until stronger signals appear.',
    topEvent:{ title:'Public source monitoring active', summary:'No dominant global escalation signal is available from current public inputs.', source:'GDELT', url:'https://www.gdeltproject.org/' },
    drivers:{ Military:38, Diplomatic:26, Cyber:18, Logistics:12, Finance:10, Disaster:7 }, weights:WEIGHTS, calculation:{ raw:31.9, containment:-3.9, final:28 },
    regions:[{name:'Ukraine',score:44,change:'+1',trend:'Watch'},{name:'Taiwan Strait',score:39,change:'0',trend:'Watch'},{name:'Middle East',score:37,change:'0',trend:'Stable'},{name:'South China Sea',score:31,change:'0',trend:'Stable'},{name:'Korea',score:25,change:'0',trend:'Stable'}],
    timeline:[{time:'NOW',text:'Fallback monitoring mode active.'}], metrics:{ conflicts:'7', conflictsSub:'MONITORED', flights:'WATCH', flightsSub:'PUBLIC SIGNALS', cyber:'WATCH', cyberSub:'LOW SURGE', logistics:'STABLE', logisticsSub:'CONTAINED' }
  };
}
