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
function countTerms(text, terms){
  return terms.reduce((n,t)=>{
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = text.match(new RegExp(escaped, 'g'));
    return n + (m ? m.length : 0);
  }, 0);
}

function severitySignals(corpus){
  const terms = {
    directMilitary: ['airstrike','air strike','missile strike','military strike','strikes on','drone attack','missile attack','bombing','shelling','invasion'],
    escalation: ['escalate','escalation','retaliation','retaliatory','mobilization','nuclear','emergency meeting'],
    majorActors: ['united states','u.s.','us military','iran','israel','russia','china','nato','taiwan'],
    globalSpillover: ['oil','tanker','red sea','strait','shipping','sanction','market','evacuation']
  };
  const out = {};
  for(const [k,v] of Object.entries(terms)) out[k] = countTerms(corpus, v);
  out.combined = out.directMilitary*8 + out.escalation*6 + out.majorActors*2 + out.globalSpillover*3;
  return out;
}

function crisisFloorFromSignals(corpus, drivers, regions){
  const sev = severitySignals(corpus);
  let floor = 8;
  if(sev.directMilitary >= 1 && sev.majorActors >= 2) floor = Math.max(floor, 38);
  if((corpus.includes('iran') && corpus.includes('israel') && sev.directMilitary >= 1) || (corpus.includes('u.s.') && corpus.includes('iran') && sev.directMilitary >= 1)) floor = Math.max(floor, 44);
  if(corpus.includes('nuclear') || corpus.includes('invasion')) floor = Math.max(floor, 48);
  if(regions[0]?.score >= 60) floor = Math.max(floor, 34);
  if(drivers.Military >= 60 && drivers.Diplomatic >= 35) floor = Math.max(floor, 32);
  return floor;
}

function analyzeArticles(articles){
  const corpus = articles.map(a=>a.title).join(' ').toLowerCase();
  const total = Math.max(articles.length,1);
  const sev = severitySignals(corpus);

  const drivers = {};
  Object.entries(CATEGORY_KEYWORDS).forEach(([cat, terms])=>{
    const count = countTerms(corpus, terms);
    const base = cat === 'Military' ? 18 : cat === 'Diplomatic' ? 12 : cat === 'Cyber' ? 7 : cat === 'Logistics' ? 7 : 5;
    let value = base + count * 5.7 + Math.min(total,60)*0.18;
    if(cat === 'Military') value += sev.directMilitary*9 + sev.escalation*4 + sev.majorActors*1.3;
    if(cat === 'Diplomatic') value += sev.escalation*3 + countTerms(corpus, ['sanction','talks','ceasefire','summit','un '])*4;
    if(cat === 'Logistics') value += sev.globalSpillover*3;
    if(cat === 'Finance') value += countTerms(corpus, ['oil','gas','market','stocks','currency'])*4;
    drivers[cat] = clamp(Math.round(value), 0, 95);
  });

  const regions = REGION_KEYWORDS.map(r=>{
    const c = countTerms(corpus, r.terms);
    let score = 12 + c*9 + drivers.Military*0.24 + drivers.Diplomatic*0.10 + drivers.Cyber*0.04;
    if(r.name === 'Middle East' && (corpus.includes('iran') || corpus.includes('israel') || corpus.includes('gaza'))) score += sev.directMilitary*7 + sev.escalation*3;
    if(r.name === 'Ukraine' && (corpus.includes('ukraine') || corpus.includes('russia'))) score += countTerms(corpus, ['missile','drone','strike','attack'])*2;
    if(r.name === 'Taiwan Strait' && (corpus.includes('taiwan') || corpus.includes('china'))) score += countTerms(corpus, ['military','navy','air force','strait'])*2;
    score = clamp(Math.round(score), 8, 92);
    return { name:r.name, score, change: c>2?'+2':c>0?'+1':'0', trend:score>=50?'Rising':c>0?'Watch':'Stable', count:c };
  }).sort((a,b)=>b.score-a.score).slice(0,5);

  const raw = Object.entries(drivers).reduce((sum,[k,v])=> sum + v*(WEIGHTS[k]||0), 0);
  const adjustment = stabilityAdjustment(drivers, regions, total, sev);
  const floor = crisisFloorFromSignals(corpus, drivers, regions);
  const final = clamp(Math.max(Math.round(raw + adjustment), floor), 5, 92);
  const confidence = clamp(Math.round(62 + Math.min(articles.length,60)*0.35 + (process.env.OPENAI_API_KEY ? 8 : 0) + Math.min(sev.combined,20)*0.25), 55, 96);
  const top = pickTopEvent(articles, regions);

  return { drivers, regions, raw, adjustment, floor, severity:sev, final, confidence, top, total };
}

function stabilityAdjustment(drivers, regions, total, sev={}){
  let adj = -3;
  if(drivers.Military > 55 && drivers.Diplomatic > 35) adj += 4;
  if(regions[0]?.score > 65) adj += 4;
  if(sev.directMilitary >= 1 && sev.majorActors >= 2) adj += 5;
  if(sev.escalation >= 2) adj += 2;
  if(total < 12) adj -= 4;
  if(drivers.Logistics < 25 && drivers.Finance < 25 && sev.globalSpillover < 2) adj -= 2;
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
    const headlines = articles.slice(0,24).map((a,i)=>`${i+1}. ${a.title} [${a.source}]`).join('\n');
    const prompt = `You are ORACLE, a calm world-risk intelligence engine. Analyze only the supplied public headlines and calculated signals. Do not invent facts. Return strict compact JSON only. No markdown.

Required JSON keys:
- assessment: 2 concise sentences explaining the current global risk posture.
- brief: 1 concise sentence for the hero area.
- scoreReason: 2-4 concise sentences explaining why the score is at this level, referring to the driver categories, strongest regions, synchronization/containment, and why it is not higher or lower.
- reasoningLines: array of exactly 5 objects. Each object must have label, delta, explanation. delta is an integer from -8 to 12 explaining score pressure, for example {"label":"Military pressure","delta":6,"explanation":"Taiwan Strait and Ukraine signals remain active."}.
- topEventIndex: integer from 1 to the supplied headline list, selecting the most globally relevant item.
- topEventTitle: short neutral title based on the selected headline.
- topSummary: 1-2 concise sentences explaining the selected event's relevance.
- outlook24h: one of STABLE, WATCH, ELEVATED, COOLING.
- riskBias: one of RISING, FLAT, FALLING.
- suggestedScore: integer 0-100 representing your independent global risk score from supplied headlines and calculated signals. Use this scale strictly: 0-20 unusually calm and rare; 21-35 normal global monitoring; 36-55 watch/elevated regional tension; 56-75 dangerous multi-region escalation; 76-100 crisis. Do not assign below 25 when Ukraine/Taiwan/Middle East military signals are present. Do not understate direct military escalation involving major states.
- scoreAdjustment: integer from -8 to 12. Use this only for AI judgement over the rule score; be conservative.
- keyDrivers: array of exactly 3 short strings naming the strongest current risk drivers.
- watchItems: array of exactly 3 short strings naming what to monitor next.
- xPost: concise English X post under 650 characters.

Tone: calm, analytical, non-alarmist. Avoid prophecy, certainty, or sensational claims.

Source mode: ${source?.sourceMode || 'unknown'}
Source error: ${source?.sourceError || 'none'}
Rule score: ${analyzed.final}
Crisis floor: ${analyzed.floor}
Severity signals: ${JSON.stringify(analyzed.severity)}
Drivers: ${JSON.stringify(analyzed.drivers)}
Regions: ${JSON.stringify(analyzed.regions)}
Calculation: raw=${round1(analyzed.raw)}, adjustment=${round1(analyzed.adjustment)}, final=${analyzed.final}
Headlines:
${headlines}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        response_format: { type:'json_object' },
        messages:[
          { role:'system', content:'You output valid compact JSON only. You are cautious, neutral, and do not exaggerate.' },
          { role:'user', content: prompt }
        ],
        temperature:0.18,
        max_tokens:950
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
      return normalizeAi(parsed, j.model || process.env.OPENAI_MODEL || 'gpt-4.1-mini');
    }catch(parseGenerated){
      return { error:'openai generated invalid json', debug:{ stage:'model_json_parse', message:parseGenerated?.message || 'invalid_json', raw:text.slice(0,500) } };
    }
  }catch(e){
    return { error:e?.message || 'ai_error', debug:{ stage:'openai_fetch', message:e?.message || 'fetch failed', cause:e?.cause ? String(e.cause) : null } };
  }
}

function normalizeAi(ai, model){
  const pick = (value, fallback='') => clean(String(value || fallback)).slice(0,900);
  const arr3 = (value, fallback) => Array.isArray(value) ? value.map(v=>clean(String(v))).filter(Boolean).slice(0,3) : fallback;
  const reasoningLines = Array.isArray(ai.reasoningLines) ? ai.reasoningLines.map(x=>({
    label: pick(x?.label, 'Risk signal').slice(0,60),
    delta: clamp(Math.round(Number(x?.delta || 0)), -8, 12),
    explanation: pick(x?.explanation, 'Public signal considered in the final score.').slice(0,160)
  })).filter(x=>x.label).slice(0,5) : [];
  const outlook = ['STABLE','WATCH','ELEVATED','COOLING'].includes(String(ai.outlook24h || '').toUpperCase()) ? String(ai.outlook24h).toUpperCase() : 'WATCH';
  const bias = ['RISING','FLAT','FALLING'].includes(String(ai.riskBias || '').toUpperCase()) ? String(ai.riskBias).toUpperCase() : 'FLAT';
  const adj = clamp(Math.round(Number(ai.scoreAdjustment || 0)), -4, 4);
  return {
    assessment: pick(ai.assessment, 'AI analysis completed. Current signals remain regionally concentrated.'),
    brief: pick(ai.brief, 'AI analysis is active. Global risk remains monitored through public signals.'),
    scoreReason: pick(ai.scoreReason, 'The score reflects weighted public signals and AI review of synchronization and containment.'),
    topEventIndex: clamp(Math.round(Number(ai.topEventIndex || 1)), 1, 24),
    topEventTitle: pick(ai.topEventTitle, ''),
    topSummary: pick(ai.topSummary, 'This event is the strongest current public signal.'),
    outlook24h: outlook,
    riskBias: bias,
    suggestedScore: clamp(Math.round(Number(ai.suggestedScore || 0)), 0, 100),
    scoreAdjustment: adj,
    reasoningLines: reasoningLines.length ? reasoningLines : [
      { label:'Military pressure', delta:3, explanation:'Military headlines remain the strongest component.' },
      { label:'Diplomatic friction', delta:2, explanation:'Diplomatic pressure contributes but remains contained.' },
      { label:'Cyber/logistics', delta:1, explanation:'Secondary signals are monitored without broad surge.' },
      { label:'Containment', delta:-3, explanation:'No synchronized global escalation is detected.' },
      { label:'AI judgement', delta:adj, explanation:'AI adjustment remains conservative.' }
    ],
    keyDrivers: arr3(ai.keyDrivers, ['Military pressure','Diplomatic friction','Regional concentration']),
    watchItems: arr3(ai.watchItems, ['Ukraine','Taiwan Strait','Middle East']),
    xPost: pick(ai.xPost, ''),
    debug:{ stage:'openai_ok', model }
  };
}

function buildPayload(analyzed, articles, llm, source){
  const aiOk = Boolean(llm && !llm.error);
  const aiAdjustment = aiOk ? clamp(Math.round(Number(llm.scoreAdjustment || 0)), -8, 12) : 0;
  const aiSuggested = aiOk && Number.isFinite(Number(llm.suggestedScore)) ? clamp(Math.round(Number(llm.suggestedScore)), 0, 100) : null;
  const ruleWithAi = analyzed.final + aiAdjustment;
  const blended = aiSuggested === null ? ruleWithAi : Math.round(ruleWithAi * 0.45 + aiSuggested * 0.55);
  const standingFloor = minimumStandingFloor(analyzed, articles, source);
  const score = clamp(Math.max(blended, analyzed.floor || 5, standingFloor), 5, 92);
  const state = stateFromScore(score);
  const topRegion = analyzed.regions[0]?.name || 'Global';
  const selectedIndex = aiOk ? clamp(Math.round(Number(llm.topEventIndex || 1)), 1, Math.max(articles.length,1)) - 1 : -1;
  const selectedTop = selectedIndex >= 0 ? articles[selectedIndex] : null;
  const top = selectedTop || analyzed.top || { title:'Public signals under monitoring', source:'GDELT', url:'https://www.gdeltproject.org/' };
  const timelineBase = articles.slice(0,4).map((a,i)=>({ time: i===0?'NOW':`-${(i+1)*12}M`, text: `${a.source}: ${a.title.slice(0,115)}` }));
  const timeline = aiOk ? [
    { time:'AI', text:`24H OUTLOOK: ${llm.outlook24h} · BIAS: ${llm.riskBias}` },
    ...timelineBase
  ] : timelineBase;

  const previousScore = clamp(score - (analyzed.regions[0]?.count > 2 ? 2 : 0) - (aiOk && llm.riskBias === 'RISING' ? 1 : 0), 0, 100);
  const sourceHealth = source?.sourceMode?.includes('LIVE') ? 96 : source?.sourceMode?.includes('CACHE') ? 88 : 82;
  const confidence = clamp(analyzed.confidence + (aiOk ? 4 : 0) - (source?.sourceError ? 8 : 0), 55, 96);

  return {
    ok:true,
    mode:'live',
    engineVersion:'ORACLE ENGINE v4.2 REASONING OUTLOOK',
    aiUsed: aiOk,
    aiMode: aiOk ? 'AI ANALYSIS ACTIVE' : 'RULE BASED',
    aiError: llm?.error || source?.sourceError || null,
    aiDebug: llm?.debug || null,
    sourceMode: source?.sourceMode || 'UNKNOWN',
    sourceError: source?.sourceError || null,
    updatedAt:new Date().toISOString(),
    score,
    previousScore,
    state,
    confidence,
    confidenceLabel:'AI CONFIDENCE',
    sourceHealth,
    outlook24h: aiOk ? llm.outlook24h : 'WATCH',
    riskBias: aiOk ? llm.riskBias : 'FLAT',
    keyDrivers: aiOk ? llm.keyDrivers : ['Military pressure','Diplomatic friction','Regional concentration'],
    reasoningLines: aiOk ? llm.reasoningLines : baselineReasoning(analyzed, score),
    watchItems: aiOk ? llm.watchItems : [topRegion,'Taiwan Strait','Middle East'],
    brief: aiOk ? llm.brief : `${topRegion} remains the highest monitored pressure point. Global escalation risk remains ${score >= 50 ? 'elevated' : 'contained'}.`,
    assessment: aiOk ? llm.assessment : `ORACLE detected ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`,
    scoreReason: aiOk ? llm.scoreReason : `Score reflects weighted public signals across military, diplomacy, cyber, logistics, finance and disaster categories, adjusted for limited global synchronization.`,
    xPost: aiOk ? llm.xPost : null,
    topEvent: {
      title: aiOk && llm.topEventTitle ? llm.topEventTitle : top.title,
      summary: aiOk ? llm.topSummary : `${topRegion} is currently the strongest contributor to the global risk index.`,
      source: top.source || 'GDELT',
      url: top.url || 'https://www.gdeltproject.org/'
    },
    drivers: analyzed.drivers,
    weights: WEIGHTS,
    calculation: { raw: round1(analyzed.raw), containment: round1(analyzed.adjustment), aiAdjustment, aiSuggestedScore: aiSuggested, crisisFloor: analyzed.floor, standingFloor, final: score, ruleFinal: analyzed.final },
    regions: analyzed.regions.map(r=>({ name:r.name, score:r.score, change:r.change, trend:r.trend })),
    timeline: timeline.length ? timeline : [{time:'NOW', text:'Monitoring active.'}],
    metrics:{
      conflicts: String(Math.max(7, analyzed.regions.filter(r=>r.score>35).length + 4)), conflictsSub:'+1 / 24H · MONITORED',
      flights: analyzed.drivers.Military > 55 ? 'ELEVATED' : 'WATCH', flightsSub: aiOk ? `AI BIAS ${llm.riskBias}` : 'PUBLIC SIGNALS',
      cyber: analyzed.drivers.Cyber > 50 ? 'MEDIUM' : 'WATCH', cyberSub: analyzed.drivers.Cyber > 50 ? 'SURGE DETECTED' : 'LOW SURGE',
      logistics: analyzed.drivers.Logistics > 45 ? 'WATCH' : 'STABLE', logisticsSub: analyzed.drivers.Logistics > 45 ? 'PRESSURE' : 'CONTAINED'
    }
  };
}


function minimumStandingFloor(analyzed, articles, source){
  // ORACLE should not treat a normal world-risk day as near-zero. This is not alarmism;
  // it preserves the scale: 0-20 = unusually calm, 21-35 = normal monitoring.
  const corpus = (articles || []).map(a=>a.title).join(' ').toLowerCase();
  let floor = source?.sourceMode?.includes('FALLBACK') ? 24 : 22;
  if(analyzed?.regions?.[0]?.score >= 35) floor = Math.max(floor, 26);
  if(analyzed?.drivers?.Military >= 35 || analyzed?.drivers?.Diplomatic >= 30) floor = Math.max(floor, 28);
  if(corpus.includes('taiwan') || corpus.includes('ukraine') || corpus.includes('iran') || corpus.includes('israel')) floor = Math.max(floor, 29);
  if(corpus.includes('strike') || corpus.includes('missile') || corpus.includes('drone') || corpus.includes('airstrike')) floor = Math.max(floor, 34);
  if((corpus.includes('u.s.') || corpus.includes('united states')) && (corpus.includes('iran') || corpus.includes('china') || corpus.includes('russia')) && (corpus.includes('strike') || corpus.includes('attack'))) floor = Math.max(floor, 42);
  return clamp(floor, 5, 55);
}

function baselineReasoning(analyzed, score){
  return [
    { label:'Military pressure', delta:Math.round((analyzed.drivers?.Military || 0)/12), explanation:'Military signals are the largest weighted component of the index.' },
    { label:'Diplomatic friction', delta:Math.round((analyzed.drivers?.Diplomatic || 0)/18), explanation:'Diplomatic and geopolitical signals add secondary pressure.' },
    { label:'Cyber / logistics', delta:Math.round(((analyzed.drivers?.Cyber || 0)+(analyzed.drivers?.Logistics || 0))/35), explanation:'Cyber and logistics remain monitored without broad disruption.' },
    { label:'Containment', delta:Math.round(analyzed.adjustment || 0), explanation:'Signals remain regionally concentrated rather than globally synchronized.' },
    { label:'Standing floor', delta:score >= 25 ? 2 : 0, explanation:'Normal global monitoring conditions keep the index above unusually calm levels.' }
  ];
}

function stateFromScore(s){ if(s>=70)return'CRITICAL'; if(s>=50)return'HIGH'; if(s>=30)return'WATCH'; return'STABLE'; }
function clamp(n,min,max){ return Math.max(min, Math.min(max, Number(n)||0)); }
function round1(n){ return Math.round(Number(n||0)*10)/10; }

function fallbackPayload(error){
  return {
    ok:true, mode:'fallback', error, aiMode:'RULE BASED', aiError:error, aiDebug:{stage:'fallback', error}, sourceMode:'FALLBACK', updatedAt:new Date().toISOString(), score:28, previousScore:25, state:'STABLE', confidence:70, confidenceLabel:'AI CONFIDENCE', sourceHealth:72,
    brief:'Public sources are partially available. ORACLE is operating in conservative monitoring mode.',
    assessment:'Signal volume is limited. The system is maintaining a stable global risk posture until stronger signals appear.',
    scoreReason:'Fallback score is based on conservative baseline monitoring values because live source retrieval did not complete.',
    topEvent:{ title:'Public source monitoring active', summary:'No dominant global escalation signal is available from current public inputs.', source:'GDELT', url:'https://www.gdeltproject.org/' },
    drivers:{ Military:38, Diplomatic:26, Cyber:18, Logistics:12, Finance:10, Disaster:7 }, weights:WEIGHTS, calculation:{ raw:31.9, containment:-3.9, final:28 },
    regions:[{name:'Ukraine',score:44,change:'+1',trend:'Watch'},{name:'Taiwan Strait',score:39,change:'0',trend:'Watch'},{name:'Middle East',score:37,change:'0',trend:'Stable'},{name:'South China Sea',score:31,change:'0',trend:'Stable'},{name:'Korea',score:25,change:'0',trend:'Stable'}],
    timeline:[{time:'NOW',text:'Fallback monitoring mode active.'}], metrics:{ conflicts:'7', conflictsSub:'+1 / 24H · MONITORED', flights:'WATCH', flightsSub:'PUBLIC SIGNALS', cyber:'WATCH', cyberSub:'LOW SURGE', logistics:'STABLE', logisticsSub:'CONTAINED' }
  };
}
