const REGION_KEYWORDS = [
  { name: 'Ukraine', terms: ['ukraine','kyiv','kiev','donetsk','kharkiv','zaporizhzhia','russia','crimea'] },
  { name: 'Taiwan Strait', terms: ['taiwan','taipei','strait','pla','china military','chinese military'] },
  { name: 'Middle East', terms: ['iran','israel','gaza','hamas','hezbollah','red sea','houthi','lebanon','syria'] },
  { name: 'South China Sea', terms: ['south china sea','philippines','spratly','scarborough','maritime'] },
  { name: 'Korea', terms: ['north korea','south korea','pyongyang','seoul'] },
  { name: 'Global Cyber', terms: ['cyber','hack','malware','ransomware','data breach','ddos'] }
];

const CATEGORY_KEYWORDS = {
  Military: ['military','missile','drone','airstrike','troops','army','navy','air force','attack','defense','war','combat','shelling','weapon','fighter','strike'],
  Diplomatic: ['sanction','summit','ceasefire','negotiation','treaty','diplomatic','minister','embassy','un ','resolution','talks','envoy'],
  Cyber: ['cyber','hack','malware','ransomware','data breach','ddos','spyware','phishing'],
  Logistics: ['shipping','port','tanker','supply chain','freight','container','canal','sea lane','logistics','vessel'],
  Finance: ['market','oil','gas','inflation','stocks','bond','currency','rate','bank','gold','dollar'],
  Disaster: ['earthquake','flood','wildfire','volcano','storm','hurricane','typhoon','tsunami','drought']
};

const WEIGHTS = { Military:.35, Diplomatic:.20, Cyber:.15, Logistics:.15, Finance:.10, Disaster:.05 };
const CACHE_TTL_MS = 10 * 60 * 1000;
const gdeltCache = globalThis.__ORACLE_GDELT_CACHE || (globalThis.__ORACLE_GDELT_CACHE = { articles:null, time:0, payload:null, payloadTime:0 });

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try{
    if(gdeltCache.payload && Date.now() - gdeltCache.payloadTime < CACHE_TTL_MS){
      return res.status(200).json({ ...gdeltCache.payload, cache:'HIT' });
    }

    const source = await fetchGdeltSafe();
    const articles = source.articles;
    const analyzed = analyzeArticles(articles);
    const llm = await aiAssessment(analyzed, articles, source);
    const payload = buildPayload(analyzed, articles, llm, source);

    gdeltCache.payload = payload;
    gdeltCache.payloadTime = Date.now();

    res.status(200).json(payload);
  }catch(error){
    res.status(200).json(fallbackPayload(error?.message || 'unknown'));
  }
}

async function fetchGdeltSafe(){
  try{
    const cachedArticles = gdeltCache.articles;
    if(cachedArticles && Date.now() - gdeltCache.time < CACHE_TTL_MS){
      return { articles: cachedArticles, sourceMode:'GDELT CACHE', sourceError:null };
    }

    const articles = await fetchGdeltRaw();
    gdeltCache.articles = articles;
    gdeltCache.time = Date.now();
    return { articles, sourceMode:'GDELT LIVE', sourceError:null };
  }catch(error){
    const message = error?.message || 'gdelt_error';
    if(gdeltCache.articles?.length){
      return { articles: gdeltCache.articles, sourceMode:'GDELT STALE CACHE', sourceError:message };
    }
    return { articles: fallbackArticles(), sourceMode:'BASELINE FALLBACK', sourceError:message };
  }
}

async function fetchGdeltRaw(){
  const query = encodeURIComponent('(military OR conflict OR missile OR drone OR cyber OR earthquake OR logistics OR shipping OR sanctions OR Taiwan OR Ukraine OR Iran OR Israel OR NATO OR Russia OR China)');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=35&sort=hybridrel&timespan=12h`;
  const r = await fetch(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/3.3' } });
  if(!r.ok) throw new Error('gdelt ' + r.status);
  const j = await r.json();
  const articles = (j.articles || []).map(a=>({
    title: clean(a.title),
    url: a.url,
    source: sourceName(a.domain),
    domain: a.domain || '',
    seen: a.seendate || '',
    language: a.language || ''
  })).filter(a=>a.title && a.url).slice(0,35);
  if(!articles.length) throw new Error('gdelt empty');
  return articles;
}

function fallbackArticles(){
  return [
    { title:'Ukraine remains a primary monitored military pressure point', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/' },
    { title:'Taiwan Strait military and diplomatic signals remain under monitoring', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/' },
    { title:'Middle East diplomatic and maritime risk signals remain contained', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/' },
    { title:'Cyber alerts show watch-level activity without global surge', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/' },
    { title:'Logistics and finance indicators remain stable despite regional pressure', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/' }
  ];
}

function clean(s=''){ return String(s).replace(/\s+/g,' ').trim(); }
function sourceName(domain=''){
  const d = domain.replace(/^www\./,'');
  if(d.includes('reuters')) return 'Reuters';
  if(d.includes('apnews')) return 'AP';
  if(d.includes('bbc')) return 'BBC';
  if(d.includes('nhk')) return 'NHK';
  if(d.includes('aljazeera')) return 'Al Jazeera';
  return d ? d.split('.')[0].slice(0,16) : 'GDELT';
}
function countTerms(text, terms){ return terms.reduce((n,t)=> n + (text.includes(t) ? 1 : 0), 0); }

function analyzeArticles(articles){
  const corpus = articles.map(a=>a.title).join(' ').toLowerCase();
  const total = Math.max(articles.length,1);

  const drivers = {};
  Object.entries(CATEGORY_KEYWORDS).forEach(([cat, terms])=>{
    const count = countTerms(corpus, terms);
    const base = cat === 'Military' ? 16 : cat === 'Diplomatic' ? 10 : cat === 'Cyber' ? 6 : 5;
    drivers[cat] = clamp(Math.round(base + count * 8 + Math.min(total,60)*0.15), 0, 90);
  });

  const regions = REGION_KEYWORDS.map(r=>{
    const c = countTerms(corpus, r.terms);
    const score = clamp(Math.round(10 + c*12 + drivers.Military*0.20 + drivers.Diplomatic*0.08 + drivers.Cyber*0.04), 8, 88);
    return { name:r.name, score, change: c>2?'+2':c>0?'+1':'0', trend:c>2?'Rising':c>0?'Watch':'Stable', count:c };
  }).sort((a,b)=>b.score-a.score).slice(0,5);

  const raw = Object.entries(drivers).reduce((sum,[k,v])=> sum + v*(WEIGHTS[k]||0), 0);
  const adjustment = stabilityAdjustment(drivers, regions, total);
  const final = clamp(Math.round(raw + adjustment), 5, 92);
  const confidence = clamp(Math.round(60 + Math.min(articles.length,60)*0.4 + (process.env.OPENAI_API_KEY ? 8 : 0)), 55, 94);
  const top = pickTopEvent(articles, regions);

  return { drivers, regions, raw, adjustment, final, confidence, top, total };
}

function stabilityAdjustment(drivers, regions, total){
  let adj = -4;
  if(drivers.Military > 55 && drivers.Diplomatic > 35) adj += 3;
  if(regions[0]?.score > 65) adj += 3;
  if(total < 12) adj -= 5;
  if(drivers.Logistics < 25 && drivers.Finance < 25) adj -= 2;
  return Math.round(adj*10)/10;
}

function pickTopEvent(articles, regions){
  if(!articles.length) return null;
  const key = (regions[0]?.name || '').split(' ')[0].toLowerCase();
  return articles.find(a=>a.title.toLowerCase().includes(key)) || articles[0];
}

async function aiAssessment(analyzed, articles, source){
  const key = process.env.OPENAI_API_KEY;
  if(!key){
    return { error:'OPENAI_API_KEY missing', debug:{ stage:'env', hasKey:false } };
  }

  try{
    const headlines = articles.slice(0,18).map((a,i)=>`${i+1}. ${a.title} [${a.source}]`).join('\n');
    const prompt = `You are ORACLE, a calm world-risk intelligence engine. Analyze only the supplied public headlines and calculated signals. Return strict JSON only with keys: assessment, brief, topSummary, scoreReason, xPost. No markdown. Keep tone calm, concise, non-alarmist.\n\nSource mode: ${source?.sourceMode || 'unknown'}\nSource error: ${source?.sourceError || 'none'}\nGlobal score: ${analyzed.final}\nDrivers: ${JSON.stringify(analyzed.drivers)}\nRegions: ${JSON.stringify(analyzed.regions)}\nCalculation: raw=${round1(analyzed.raw)}, adjustment=${round1(analyzed.adjustment)}, final=${analyzed.final}\nHeadlines:\n${headlines}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        response_format: { type:'json_object' },
        messages:[
          { role:'system', content:'You output valid compact JSON only.' },
          { role:'user', content: prompt }
        ],
        temperature:0.25,
        max_tokens:700
      })
    });

    let j = null;
    try{ j = await r.json(); }catch(parseError){
      return { error:`openai ${r.status} invalid_json`, debug:{ stage:'openai_parse', status:r.status, message:parseError?.message || 'parse failed' } };
    }

    if(!r.ok){
      return { error:`openai ${r.status}: ${j?.error?.message || 'unknown'}`, debug:{ stage:'openai_http', status:r.status, message:j?.error?.message || null, type:j?.error?.type || null, code:j?.error?.code || null } };
    }

    const text = j.choices?.[0]?.message?.content || '';
    try{
      const parsed = JSON.parse(text);
      return { ...parsed, debug:{ stage:'openai_ok', status:r.status, model:j.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini' } };
    }catch(parseGenerated){
      return { error:'openai generated invalid json', debug:{ stage:'model_json_parse', message:parseGenerated?.message || 'invalid_json', raw:text.slice(0,500) } };
    }
  }catch(e){
    return { error:e?.message || 'ai_error', debug:{ stage:'openai_fetch', message:e?.message || 'fetch failed', cause:e?.cause ? String(e.cause) : null } };
  }
}

function buildPayload(analyzed, articles, llm, source){
  const score = analyzed.final;
  const state = stateFromScore(score);
  const top = analyzed.top || { title:'Public signals under monitoring', source:'GDELT', url:'https://www.gdeltproject.org/' };
  const topRegion = analyzed.regions[0]?.name || 'Global';
  const timeline = articles.slice(0,5).map((a,i)=>({ time: i===0?'NOW':`-${(i+1)*12}M`, text: `${a.source}: ${a.title.slice(0,115)}` }));
  const aiOk = Boolean(llm && !llm.error);

  return {
    ok:true,
    mode:'live',
    aiUsed: aiOk,
    aiMode: aiOk ? 'AI ANALYSIS ACTIVE' : 'RULE BASED',
    aiError: llm?.error || source?.sourceError || null,
    aiDebug: llm?.debug || null,
    sourceMode: source?.sourceMode || 'UNKNOWN',
    sourceError: source?.sourceError || null,
    updatedAt:new Date().toISOString(),
    score,
    previousScore: clamp(score - (analyzed.regions[0]?.count > 2 ? 2 : 0), 0, 100),
    state,
    confidence: analyzed.confidence,
    sourceHealth: articles.length > 10 ? 96 : 82,
    brief: aiOk ? llm.brief : `${topRegion} remains the highest monitored pressure point. Global escalation risk remains ${score >= 50 ? 'elevated' : 'contained'}.`,
    assessment: aiOk ? llm.assessment : `ORACLE detected ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`,
    scoreReason: aiOk ? llm.scoreReason : `Score reflects weighted public signals across military, diplomacy, cyber, logistics, finance and disaster categories, adjusted for limited global synchronization.`,
    xPost: aiOk ? llm.xPost : null,
    topEvent: { title: top.title, summary: aiOk ? llm.topSummary : `${topRegion} is currently the strongest contributor to the global risk index.`, source: top.source || 'GDELT', url: top.url || 'https://www.gdeltproject.org/' },
    drivers: analyzed.drivers,
    weights: WEIGHTS,
    calculation: { raw: round1(analyzed.raw), containment: round1(analyzed.adjustment), final: score },
    regions: analyzed.regions.map(r=>({ name:r.name, score:r.score, change:r.change, trend:r.trend })),
    timeline: timeline.length ? timeline : [{time:'NOW', text:'Monitoring active.'}],
    metrics:{
      conflicts: String(Math.max(7, analyzed.regions.filter(r=>r.score>35).length + 4)), conflictsSub:'+1 / 24H · MONITORED',
      flights: analyzed.drivers.Military > 55 ? 'ELEVATED' : 'WATCH', flightsSub:'PUBLIC SIGNALS',
      cyber: analyzed.drivers.Cyber > 50 ? 'MEDIUM' : 'WATCH', cyberSub: analyzed.drivers.Cyber > 50 ? 'SURGE DETECTED' : 'LOW SURGE',
      logistics: analyzed.drivers.Logistics > 45 ? 'WATCH' : 'STABLE', logisticsSub: analyzed.drivers.Logistics > 45 ? 'PRESSURE' : 'CONTAINED'
    }
  };
}

function stateFromScore(s){ if(s>=70)return'CRITICAL'; if(s>=50)return'HIGH'; if(s>=30)return'WATCH'; return'STABLE'; }
function clamp(n,min,max){ return Math.max(min, Math.min(max, Number(n)||0)); }
function round1(n){ return Math.round(Number(n||0)*10)/10; }

function fallbackPayload(error){
  return {
    ok:true, mode:'fallback', error, aiMode:'RULE BASED', aiError:error, aiDebug:{stage:'fallback', error}, sourceMode:'FALLBACK', updatedAt:new Date().toISOString(), score:28, previousScore:25, state:'STABLE', confidence:70, sourceHealth:72,
    brief:'Public sources are partially available. ORACLE is operating in conservative monitoring mode.',
    assessment:'Signal volume is limited. The system is maintaining a stable global risk posture until stronger signals appear.',
    scoreReason:'Fallback score is based on conservative baseline monitoring values because live source retrieval did not complete.',
    topEvent:{ title:'Public source monitoring active', summary:'No dominant global escalation signal is available from current public inputs.', source:'GDELT', url:'https://www.gdeltproject.org/' },
    drivers:{ Military:38, Diplomatic:26, Cyber:18, Logistics:12, Finance:10, Disaster:7 }, weights:WEIGHTS, calculation:{ raw:31.9, containment:-3.9, final:28 },
    regions:[{name:'Ukraine',score:44,change:'+1',trend:'Watch'},{name:'Taiwan Strait',score:39,change:'0',trend:'Watch'},{name:'Middle East',score:37,change:'0',trend:'Stable'},{name:'South China Sea',score:31,change:'0',trend:'Stable'},{name:'Korea',score:25,change:'0',trend:'Stable'}],
    timeline:[{time:'NOW',text:'Fallback monitoring mode active.'}], metrics:{ conflicts:'7', conflictsSub:'+1 / 24H · MONITORED', flights:'WATCH', flightsSub:'PUBLIC SIGNALS', cyber:'WATCH', cyberSub:'LOW SURGE', logistics:'STABLE', logisticsSub:'CONTAINED' }
  };
}
