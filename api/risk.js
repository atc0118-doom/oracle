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
const ORACLE_CACHE = globalThis.__ORACLE_CACHE__ || (globalThis.__ORACLE_CACHE__ = { articles:null, ts:0, lastError:null });
const CACHE_TTL_MS = 5 * 60 * 1000;

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=240');

  try{
    const { articles, sourceError, degraded } = await loadArticles();
    const analyzed = analyzeArticles(articles);
    const llm = await aiAssessment(analyzed, articles, sourceError);
    const payload = buildPayload(analyzed, articles, llm, { sourceError, degraded });
    res.status(200).json(payload);
  }catch(error){
    res.status(200).json(fallbackPayload(error?.message || 'unknown'));
  }
}

async function loadArticles(){
  try{
    const articles = await fetchGdelt();
    if(articles.length){
      ORACLE_CACHE.articles = articles;
      ORACLE_CACHE.ts = Date.now();
      ORACLE_CACHE.lastError = null;
      return { articles, sourceError:null, degraded:false };
    }
  }catch(error){
    const msg = error?.message || 'source_error';
    ORACLE_CACHE.lastError = msg;
    if(ORACLE_CACHE.articles?.length){
      return { articles:ORACLE_CACHE.articles, sourceError:msg + ' · using cache', degraded:true };
    }
    return { articles:baselineArticles(msg), sourceError:msg + ' · using baseline signals', degraded:true };
  }
  return { articles:baselineArticles('empty source response'), sourceError:'empty source response · using baseline signals', degraded:true };
}

async function fetchGdelt(){
  const now = Date.now();
  if(ORACLE_CACHE.articles?.length && now - ORACLE_CACHE.ts < CACHE_TTL_MS){
    return ORACLE_CACHE.articles;
  }
  const query = encodeURIComponent('(military OR conflict OR missile OR drone OR cyber OR earthquake OR logistics OR shipping OR sanctions OR Taiwan OR Ukraine OR Iran OR Israel OR NATO OR Russia OR China)');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=45&sort=hybridrel&timespan=24h`;
  const r = await fetch(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/5.2' } });
  if(!r.ok) throw new Error('gdelt ' + r.status);
  const j = await r.json();
  return (j.articles || []).map(a=>({
    title: clean(a.title),
    url: a.url,
    source: sourceName(a.domain),
    domain: a.domain || '',
    seen: a.seendate || '',
    language: a.language || ''
  })).filter(a=>a.title && a.url).slice(0,45);
}

function baselineArticles(reason='source degraded'){
  const now = new Date().toISOString();
  return [
    { title:'Ukraine remains under active conflict monitoring as military signals continue', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English' },
    { title:'Taiwan Strait remains under watch due to military and diplomatic signals', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English' },
    { title:'Middle East tensions remain monitored with Iran Israel and Red Sea signals', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English' },
    { title:'Cyber security alerts remain at watch level with no broad global surge', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English' },
    { title:'Logistics and shipping pressure remains contained across monitored public sources', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English' },
    { title:`Public source degradation detected: ${reason}`, source:'ORACLE System', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English' }
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

async function aiAssessment(analyzed, articles, sourceError=null){
  const key = process.env.OPENAI_API_KEY;
  if(!key) return null;

  try{
    const headlines = articles.slice(0,18).map((a,i)=>`${i+1}. ${a.title} [${a.source}]`).join('\n');
    const prompt = `You are ORACLE, a calm world-risk intelligence engine. Analyze ONLY the supplied public headlines and calculated signals.
Return strict JSON only. No markdown.
Required keys:
- facts: array of 2 to 4 short source-bound observations from the supplied headlines only.
- assessment: 1 to 2 sentence AI assessment, clearly separated from facts.
- brief: 1 concise source-bound summary for the hero area.
- topSummary: 1 sentence explanation of why the selected top event matters.
- scoreReason: 1 sentence explaining the score using drivers and public signals.
- outlook24h: one of STABLE, WATCH, ESCALATING, DE-ESCALATING.
- outlookText: 1 sentence explaining the 24h outlook without claiming certainty.
- keyDrivers: array of 3 to 5 short driver labels.
- watchNext: array of 3 to 5 short items ORACLE should monitor next.
- sourceConfidence: object with availableSources array, limitedSources array, note string.
- xPostGlobal: English post under 650 characters, world-facing tone, source-bound, cautious.
- xPostJapanese: Japanese post under 650 Japanese characters, calm and concise, source-bound.
- hashtags: array of 8 to 14 relevant English hashtags.

CRITICAL SAFETY / RELIABILITY RULES:
- Separate FACTS from AI ASSESSMENT. Facts must be based only on supplied headlines.
- Do not invent events, casualties, strikes, declarations, locations, dates, or sources.
- Do not state an event as confirmed unless a supplied headline clearly states it.
- Prefer cautious language: "public reporting indicates", "monitored headlines suggest", "available signals indicate", "appears", "may", "remains under watch".
- If sources are degraded or baseline signals are used, explicitly say monitoring is based on limited public signals.
- Do not predict war, collapse, escalation, or attacks as certainty.
- Avoid alarmist wording. ORACLE observes and assesses; it does not claim prophecy.
- Keep statements source-bound and concise.
- If a claim is not directly supported by a supplied headline, write about elevated tensions or monitored signals instead.

X post rules:
- Always include the score and state.
- Avoid definitive claims unless directly supported by supplied headlines.
- hashtags must always include ORACLE, WorldRiskIndex, GlobalRisk, AIAnalysis, OSINT. Add topical tags only when supported by supplied headlines, such as Ukraine, Russia, Taiwan, China, MiddleEast, Iran, Israel, CyberSecurity, Earthquake, Logistics, Energy, Geopolitics.

Global score: ${analyzed.final}
Drivers: ${JSON.stringify(analyzed.drivers)}
Regions: ${JSON.stringify(analyzed.regions)}
Calculation: raw=${round1(analyzed.raw)}, adjustment=${round1(analyzed.adjustment)}, final=${analyzed.final}
Source status: ${sourceError ? 'DEGRADED: '+sourceError : 'LIVE'}
Headlines:
${headlines}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'content-type':'application/json', authorization:`Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        response_format: { type:'json_object' },
        messages:[
          { role:'system', content:'You output valid compact JSON only.' },
          { role:'user', content: prompt }
        ],
        temperature:0.25,
        max_tokens:1000
      })
    });

    if(!r.ok){
      let detail = '';
      try{ const ej = await r.json(); detail = ej?.error?.message || JSON.stringify(ej).slice(0,220); }catch(_){ detail = await r.text().catch(()=> ''); }
      return { error:`openai ${r.status}${detail ? ' · '+detail : ''}` };
    }
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    return JSON.parse(text);
  }catch(e){
    return { error:e?.message || 'ai_error' };
  }
}


function safeIntelText(text='', fallback='Public signals remain under monitoring.'){
  let out = String(text || '').replace(/\s+/g,' ').trim();
  if(!out) return fallback;

  // Keep ORACLE language source-bound. This is deliberately conservative:
  // it softens unsupported-sounding certainty without changing factual meaning.
  const riskyStarts = [
    [/^The U\.S\. has launched/i, 'Public reporting indicates possible U.S.-linked'],
    [/^The U\.S\. launched/i, 'Public reporting indicates possible U.S.-linked'],
    [/^The U\.S\. has initiated/i, 'Public reporting indicates possible U.S.-linked'],
    [/^The U\.S\. initiated/i, 'Public reporting indicates possible U.S.-linked'],
    [/^Iran has/i, 'Public reporting indicates Iran has'],
    [/^Israel has/i, 'Public reporting indicates Israel has'],
    [/^Russia has/i, 'Public reporting indicates Russia has'],
    [/^China has/i, 'Public reporting indicates China has']
  ];
  for(const [re, rep] of riskyStarts){ out = out.replace(re, rep); }

  // Avoid absolute forecasts.
  out = out.replace(/\bwill escalate\b/gi, 'may escalate');
  out = out.replace(/\bwill lead to\b/gi, 'may contribute to');
  out = out.replace(/\bimminent global escalation\b/gi, 'immediate global escalation signal');
  return out.slice(0, 520);
}

function safeHashtags(tags){
  const base = ['ORACLE','WorldRiskIndex','GlobalRisk','AIAnalysis','OSINT'];
  const cleanTags = Array.isArray(tags) ? tags : [];
  const allowed = cleanTags
    .map(t=>String(t).replace(/^#/,'').replace(/[^A-Za-z0-9_]/g,''))
    .filter(Boolean);
  return [...new Set([...base, ...allowed])].slice(0,14);
}

function normalizeOutlook(v=''){
  const s = String(v || '').toUpperCase().replace(/[^A-Z-]/g,'');
  if(['STABLE','WATCH','ESCALATING','DE-ESCALATING'].includes(s)) return s;
  return 'STABLE';
}

function safeList(list, topRegion, analyzed){
  const arr = Array.isArray(list) ? list : [];
  return arr.map(x=>clean(String(x))).filter(Boolean).slice(0,5);
}
function fallbackDrivers(topRegion, analyzed){
  return [
    `${topRegion} regional pressure`,
    `Military signal ${Math.round(analyzed.drivers.Military)}`,
    `Diplomatic signal ${Math.round(analyzed.drivers.Diplomatic)}`,
    'No synchronized global escalation signal'
  ];
}
function fallbackWatchNext(topRegion){
  return [
    `${topRegion} public reporting`,
    'Military and diplomatic statements',
    'Cyber and logistics spillover',
    'Verified multi-source escalation signals'
  ];
}
function normalizeSourceConfidence(sc, articles, meta){
  const sources = [...new Set((articles||[]).map(a=>a.source).filter(Boolean))].slice(0,8);
  const limited = meta?.degraded ? ['GDELT'] : [];
  return {
    availableSources: Array.isArray(sc?.availableSources) ? sc.availableSources.slice(0,8) : sources,
    limitedSources: Array.isArray(sc?.limitedSources) ? sc.limitedSources.slice(0,5) : limited,
    note: safeIntelText(sc?.note || (meta?.degraded ? 'Some public sources are degraded; ORACLE is using cached or baseline signals.' : 'Public source coverage is currently available for monitored signals.'), 'Source confidence is being monitored.')
  };
}
function buildFacts(articles, llm, meta){
  const aiFacts = Array.isArray(llm?.facts) ? llm.facts : [];
  const facts = aiFacts.map(f=>safeIntelText(f,'')).filter(Boolean).slice(0,4);
  if(facts.length) return facts;
  const topArticles = (articles||[]).slice(0,3).map(a=>`${a.source}: ${a.title}`);
  if(meta?.degraded) topArticles.unshift('Source status: live public source retrieval is limited; cached or baseline signals may be used.');
  return topArticles.length ? topArticles : ['Public signals are being monitored.'];
}
function buildReasoning(analyzed, topRegion){
  const d = analyzed.drivers || {};
  return [
    { label:'Military pressure', delta: Math.round((d.Military||0) * .12), text:`Military signal level ${Math.round(d.Military||0)}` },
    { label:'Diplomatic friction', delta: Math.round((d.Diplomatic||0) * .08), text:`Diplomatic signal level ${Math.round(d.Diplomatic||0)}` },
    { label:'Cyber / logistics', delta: Math.round(((d.Cyber||0)+(d.Logistics||0)) * .035), text:'Secondary spillover indicators remain monitored' },
    { label:'Regional concentration', delta: Math.round((analyzed.regions?.[0]?.score||0) * .05), text:`Highest pressure: ${topRegion}` },
    { label:'Containment adjustment', delta: Math.round(analyzed.adjustment||0), text:'Adjustment for unsynchronized global escalation signals' }
  ];
}

function buildPayload(analyzed, articles, llm, meta={}){
  const score = analyzed.final;
  const state = stateFromScore(score);
  const top = analyzed.top || { title:'Public signals under monitoring', source:'GDELT', url:'https://www.gdeltproject.org/' };
  const topRegion = analyzed.regions[0]?.name || 'Global';
  const timeline = articles.slice(0,5).map((a,i)=>({ time: i===0?'NOW':`-${(i+1)*12}M`, text: `${a.source}: ${a.title.slice(0,115)}` }));
  const aiOk = Boolean(llm && !llm.error);

  return {
    ok:true,
    mode: meta.degraded ? 'degraded' : 'live',
    aiUsed: aiOk,
    aiMode: aiOk ? 'AI ANALYSIS ACTIVE' : 'RULE BASED',
    aiError: llm?.error || null,
    sourceError: meta.sourceError || null,
    updatedAt:new Date().toISOString(),
    score,
    previousScore: clamp(score - (analyzed.regions[0]?.count > 2 ? 2 : 0), 0, 100),
    state,
    confidence: analyzed.confidence,
    sourceHealth: meta.degraded ? 72 : (articles.length > 10 ? 96 : 82),
    facts: buildFacts(articles, llm, meta),
    outlook24h: aiOk ? normalizeOutlook(llm.outlook24h) : (score >= 50 ? 'WATCH' : 'STABLE'),
    outlookText: aiOk ? safeIntelText(llm.outlookText, 'Available public signals suggest conditions should continue to be monitored over the next 24 hours.') : 'Available public signals suggest conditions should continue to be monitored over the next 24 hours.',
    keyDrivers: aiOk ? safeList(llm.keyDrivers, topRegion, analyzed) : fallbackDrivers(topRegion, analyzed),
    watchNext: aiOk ? safeList(llm.watchNext, topRegion, analyzed) : fallbackWatchNext(topRegion),
    sourceConfidence: aiOk ? normalizeSourceConfidence(llm.sourceConfidence, articles, meta) : normalizeSourceConfidence(null, articles, meta),
    brief: aiOk ? safeIntelText(llm.brief, `${topRegion} remains the highest monitored pressure point. Global escalation risk remains ${score >= 50 ? 'elevated' : 'contained'}.`) : `${topRegion} remains the highest monitored pressure point. Global escalation risk remains ${score >= 50 ? 'elevated' : 'contained'}.`,
    assessment: aiOk ? safeIntelText(llm.assessment, `ORACLE detected ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`) : `ORACLE detected ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`,
    scoreReason: aiOk ? safeIntelText(llm.scoreReason, `Score reflects weighted public signals across military, diplomacy, cyber, logistics, finance and disaster categories, adjusted for limited global synchronization.`) : `Score reflects weighted public signals across military, diplomacy, cyber, logistics, finance and disaster categories, adjusted for limited global synchronization.`,
    xPost: aiOk ? safeIntelText(llm.xPostGlobal || llm.xPost, '') : null,
    xPostGlobal: aiOk ? safeIntelText(llm.xPostGlobal || llm.xPost, '') : null,
    xPostJapanese: aiOk ? safeIntelText(llm.xPostJapanese, '') : null,
    hashtags: aiOk ? safeHashtags(llm.hashtags) : null,
    topEvent: { title: top.title, summary: aiOk ? safeIntelText(llm.topSummary, `${topRegion} is currently the strongest contributor to the global risk index.`) : `${topRegion} is currently the strongest contributor to the global risk index.`, source: top.source || 'GDELT', url: top.url || 'https://www.gdeltproject.org/' },
    drivers: analyzed.drivers,
    weights: WEIGHTS,
    calculation: { raw: round1(analyzed.raw), containment: round1(analyzed.adjustment), final: score, reasoning: buildReasoning(analyzed, topRegion) },
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
    ok:true, mode:'fallback', error, aiMode:'RULE BASED', updatedAt:new Date().toISOString(), score:28, previousScore:25, state:'STABLE', confidence:70, sourceHealth:72,
    brief:'Public sources are partially available. ORACLE is operating in conservative monitoring mode.',
    assessment:'Signal volume is limited. The system is maintaining a stable global risk posture until stronger signals appear.',
    scoreReason:'Fallback score is based on conservative baseline monitoring values because live source retrieval did not complete.',
    facts:['Public source retrieval is limited.', 'ORACLE is using conservative baseline monitoring signals.', 'No synchronized global escalation signal is available from current inputs.'],
    outlook24h:'STABLE', outlookText:'Conditions remain stable unless additional verified public signals emerge.',
    keyDrivers:['Baseline military monitoring','Limited source volume','Regional pressure only'],
    watchNext:['GDELT availability','Verified regional escalation signals','Major diplomatic or logistics changes'],
    sourceConfidence:{availableSources:['GDELT'],limitedSources:['GDELT'],note:'Live public source retrieval is degraded.'},
    topEvent:{ title:'Public source monitoring active', summary:'No dominant global escalation signal is available from current public inputs.', source:'GDELT', url:'https://www.gdeltproject.org/' },
    drivers:{ Military:38, Diplomatic:26, Cyber:18, Logistics:12, Finance:10, Disaster:7 }, weights:WEIGHTS, calculation:{ raw:31.9, containment:-3.9, final:28 },
    regions:[{name:'Ukraine',score:44,change:'+1',trend:'Watch'},{name:'Taiwan Strait',score:39,change:'0',trend:'Watch'},{name:'Middle East',score:37,change:'0',trend:'Stable'},{name:'South China Sea',score:31,change:'0',trend:'Stable'},{name:'Korea',score:25,change:'0',trend:'Stable'}],
    timeline:[{time:'NOW',text:'Fallback monitoring mode active.'}], metrics:{ conflicts:'7', conflictsSub:'+1 / 24H · MONITORED', flights:'WATCH', flightsSub:'PUBLIC SIGNALS', cyber:'WATCH', cyberSub:'LOW SURGE', logistics:'STABLE', logisticsSub:'CONTAINED' }
  };
}
