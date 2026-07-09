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
const ORACLE_CACHE = globalThis.__ORACLE_CACHE__ || (globalThis.__ORACLE_CACHE__ = { articles:null, ts:0, lastError:null, sourceReport:null });
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6500;

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=240');

  try{
    const { articles, sourceError, degraded, sourceReport } = await loadArticles();
    const analyzed = analyzeArticles(articles);
    const llm = await aiAssessment(analyzed, articles, sourceError);
    const payload = buildPayload(analyzed, articles, llm, { sourceError, degraded, sourceReport });
    res.status(200).json(payload);
  }catch(error){
    res.status(200).json(fallbackPayload(error?.message || 'unknown'));
  }
}

async function loadArticles(){
  const now = Date.now();
  if(ORACLE_CACHE.articles?.length && now - ORACLE_CACHE.ts < CACHE_TTL_MS){
    return { articles:ORACLE_CACHE.articles, sourceError:ORACLE_CACHE.lastError, degraded:false, sourceReport:ORACLE_CACHE.sourceReport || [] };
  }

  const collectors = [
    ['GDELT', fetchGdelt],
    ['Google News', fetchGoogleNews],
    ['USGS', fetchUSGS],
    ['NOAA', fetchNOAA],
    ['Guardian', fetchGuardian]
  ];

  const settled = await Promise.allSettled(collectors.map(async ([name, fn])=>{
    const items = await fn();
    return { name, ok:true, count:items.length, items };
  }));

  const report = settled.map((r,i)=>{
    const name = collectors[i][0];
    if(r.status === 'fulfilled') return { name, ok:true, count:r.value.count };
    return { name, ok:false, count:0, error:r.reason?.message || 'source_error' };
  });

  let articles = [];
  for(const r of settled){
    if(r.status === 'fulfilled') articles.push(...r.value.items);
  }
  articles = dedupeArticles(articles).slice(0,80);

  const failed = report.filter(r=>!r.ok).map(r=>`${r.name} ${r.error}`);
  const sourceError = failed.length ? failed.join(' · ') : null;
  const available = report.filter(r=>r.ok && r.count>0).length;

  if(articles.length){
    ORACLE_CACHE.articles = articles;
    ORACLE_CACHE.ts = Date.now();
    ORACLE_CACHE.lastError = sourceError;
    ORACLE_CACHE.sourceReport = report;
    return { articles, sourceError, degraded: available < 2, sourceReport:report };
  }

  if(ORACLE_CACHE.articles?.length){
    return { articles:ORACLE_CACHE.articles, sourceError:(sourceError || 'all sources empty') + ' · using cache', degraded:true, sourceReport:report };
  }

  return { articles:baselineArticles(sourceError || 'all public sources unavailable'), sourceError:(sourceError || 'all public sources unavailable') + ' · using baseline signals', degraded:true, sourceReport:report };
}

async function fetchWithTimeout(url, options={}){
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), options.timeout || FETCH_TIMEOUT_MS);
  try{
    return await fetch(url, { ...options, signal:controller.signal });
  }finally{
    clearTimeout(timeout);
  }
}

async function fetchGdelt(){
  const query = encodeURIComponent('(military OR conflict OR missile OR drone OR cyber OR earthquake OR logistics OR shipping OR sanctions OR Taiwan OR Ukraine OR Iran OR Israel OR NATO OR Russia OR China)');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=45&sort=hybridrel&timespan=24h`;
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/7.2' } });
  if(!r.ok) throw new Error('gdelt ' + r.status);
  const j = await r.json();
  return (j.articles || []).map(a=>({
    title: clean(a.title),
    url: a.url,
    source: sourceName(a.domain),
    domain: a.domain || '',
    seen: a.seendate || '',
    language: a.language || '',
    sourceType:'event-feed'
  })).filter(a=>a.title && a.url).slice(0,45);
}

async function fetchGoogleNews(){
  const q = encodeURIComponent('(Ukraine OR Taiwan OR Iran OR Israel OR cyber OR earthquake OR shipping OR NATO OR Russia OR China) when:1d');
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/7.2' } });
  if(!r.ok) throw new Error('google_news ' + r.status);
  const xml = await r.text();
  return parseRss(xml, 'Google News').slice(0,25);
}

async function fetchGuardian(){
  const key = process.env.GUARDIAN_API_KEY;
  if(!key) return [];
  const q = encodeURIComponent('Ukraine OR Taiwan OR Iran OR Israel OR cyber OR earthquake OR shipping OR Russia OR China');
  const url = `https://content.guardianapis.com/search?q=${q}&section=world|technology|business|environment&show-fields=trailText&order-by=newest&page-size=20&api-key=${key}`;
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/7.2' } });
  if(!r.ok) throw new Error('guardian ' + r.status);
  const j = await r.json();
  return (j.response?.results || []).map(a=>({
    title: clean(a.webTitle),
    url: a.webUrl,
    source:'Guardian',
    domain:'theguardian.com',
    seen:a.webPublicationDate || '',
    language:'English',
    sourceType:'news-api'
  })).filter(a=>a.title && a.url);
}

async function fetchUSGS(){
  const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson';
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/7.2' } });
  if(!r.ok) throw new Error('usgs ' + r.status);
  const j = await r.json();
  return (j.features || []).slice(0,12).map(f=>({
    title:`Earthquake ${f.properties?.mag || ''} - ${f.properties?.place || 'location under review'}`,
    url:f.properties?.url || 'https://earthquake.usgs.gov/',
    source:'USGS',
    domain:'usgs.gov',
    seen:f.properties?.time ? new Date(f.properties.time).toISOString() : '',
    language:'English',
    sourceType:'disaster-feed'
  })).filter(a=>a.title);
}

async function fetchNOAA(){
  const url = 'https://services.swpc.noaa.gov/products/alerts.json';
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/7.2' } });
  if(!r.ok) throw new Error('noaa ' + r.status);
  const j = await r.json();
  const rows = Array.isArray(j) ? j.slice(-10) : [];
  return rows.map(row=>{
    const msg = Array.isArray(row) ? row.join(' ') : JSON.stringify(row);
    return { title:`Space weather alert: ${clean(msg).slice(0,140)}`, url:'https://www.swpc.noaa.gov/', source:'NOAA', domain:'noaa.gov', seen:'', language:'English', sourceType:'space-weather' };
  }).filter(a=>a.title && !/message issue_datetime/.test(a.title.toLowerCase())).slice(0,8);
}

function parseRss(xml, fallbackSource='RSS'){
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m=>m[1]);
  return items.map(block=>{
    const title = decodeXml((block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] || block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').replace(/ - [^-]+$/,''));
    const url = decodeXml(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '');
    const source = decodeXml(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || fallbackSource);
    const pub = decodeXml(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '');
    return { title:clean(title), url, source:clean(source) || fallbackSource, domain:'news.google.com', seen:pub, language:'English', sourceType:'rss' };
  }).filter(a=>a.title && a.url);
}

function decodeXml(s=''){
  return String(s).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}

function dedupeArticles(articles){
  const seen = new Set();
  const out = [];
  for(const a of articles){
    const key = clean(a.title).toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ').slice(0,12).join(' ');
    if(!key || seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
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
  const sourceDiversity = new Set(articles.map(a=>a.source).filter(Boolean)).size;
  const confidence = clamp(Math.round(58 + Math.min(articles.length,80)*0.28 + sourceDiversity*3 + (process.env.OPENAI_API_KEY ? 8 : 0)), 55, 96);
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
- facts: array of 2 to 4 short source-bound observations from the supplied headlines only. Prefer source + headline summaries, not analysis.
- assessment: 1 to 2 sentence AI assessment, clearly separated from facts.
- brief: 1 concise source-bound summary for the hero area, maximum 120 characters, no more than one sentence.
- topSummary: 1 sentence explanation of why the selected top event matters.
- scoreReason: 1 sentence explaining the score using drivers and public signals.
- outlook24h: one of STABLE, WATCH, ESCALATING, DE-ESCALATING.
- outlookText: 1 sentence explaining the 24h outlook without claiming certainty.
- keyDrivers: array of 3 to 5 short driver labels.
- watchNext: array of 3 to 5 short items ORACLE should monitor next.
- sourceConfidence: object with availableSources array, limitedSources array, note string.
- verifiedSources: array of source names actually present in supplied headlines.
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
- Never infer reactions, retaliation, effects, causality, investment impact, or strategic intent unless the supplied headline explicitly says so.
- Do not merge two separate headlines into one causal claim.
- Use phrases like "headlines report", "public headlines indicate", or "available reporting mentions" when describing specific events.
- For FACTS, prefer neutral summaries over dramatic verbs. Avoid "intensifying", "responding aggressively", "driving", "triggering", or "proving" unless those exact ideas are present in supplied headlines.


- Keep the hero brief short enough for a mobile screen. Do not exceed 120 characters.
- Do not combine U.S./Iran and Ukraine headlines into a single causal sentence.
- Use neutral phrasing: "headlines mention", "public reporting references", "monitoring continues".
- If evidence is mixed or source volume is limited, say so plainly.

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


function isUnsupportedSpecific(text='', corpus=''){
  const t = String(text || '').toLowerCase();
  const c = String(corpus || '').toLowerCase();
  const riskyPhrases = [
    'responding aggressively',
    'response aggressively',
    'are intensifying',
    'is intensifying',
    'intensifying',
    'affecting russian military investments',
    'affecting military investments',
    'drive heightened',
    'drives heightened',
    'has launched new strikes',
    'launched new strikes',
    'initiated new strikes',
    'new strikes against iran',
    'u.s. military strikes against iran',
    'us military strikes against iran'
  ];
  if(riskyPhrases.some(p=>t.includes(p) && !c.includes(p))) return true;

  // Specific strike/attack claims require the corpus to contain a close headline-level signal.
  const claimsSpecificStrike = /\b(u\.s\.|us|united states|israel|iran|russia|ukraine|china)\b.{0,80}\b(strike|strikes|airstrike|airstrikes|attack|attacks|missile|missiles|launched|initiated)\b/i.test(text);
  const corpusSpecificStrike = /\b(u\.s\.|us|united states|israel|iran|russia|ukraine|china)\b.{0,120}\b(strike|strikes|airstrike|airstrikes|attack|attacks|missile|missiles|launched|initiated)\b/i.test(corpus);
  if(claimsSpecificStrike && !corpusSpecificStrike) return true;

  // Causal language is frequently hallucinated; only allow if corpus also contains that framing.
  const causal = /\b(caused|causing|triggered|triggering|drives|driving|forcing|forced|proves|retaliated|retaliation|responding aggressively|impacting|affecting)\b/i.test(text);
  const causalInCorpus = /\b(caused|causing|triggered|triggering|drives|driving|forcing|forced|proves|retaliated|retaliation|responding aggressively|impacting|affecting)\b/i.test(corpus);
  if(causal && !causalInCorpus) return true;

  return false;
}

function conservativeSummary(topRegion='Global', score=0){
  const state = score >= 50 ? 'elevated' : score >= 30 ? 'under watch' : 'stable';
  return `Available public headlines indicate ${state} monitoring conditions, with ${topRegion} currently the main area of attention. Broader global escalation signals remain limited.`;
}

function reliabilityRewrite(text='', corpus=''){
  let out = String(text || '');
  const c = String(corpus || '').toLowerCase();

  // Convert overly certain language into cautious intelligence language.
  out = out.replace(/\bconfirmed\b/gi, 'reported');
  out = out.replace(/\bproves\b/gi, 'indicates');
  out = out.replace(/\bwill\b/gi, 'may');
  out = out.replace(/\bhas launched new strikes\b/gi, 'is mentioned in public reporting in connection with possible military activity');
  out = out.replace(/\blaunched new strikes\b/gi, 'is mentioned in public reporting in connection with possible military activity');
  out = out.replace(/\bare intensifying\b/gi, 'remain under watch');
  out = out.replace(/\bis intensifying\b/gi, 'remains under watch');
  out = out.replace(/\bresponding aggressively\b/gi, 'also appearing in related public reporting');
  out = out.replace(/\bdrives heightened\b/gi, 'coincides with elevated');
  out = out.replace(/\bdrive heightened\b/gi, 'coincide with elevated');
  out = out.replace(/\baffecting Russian military investments\b/gi, 'appearing in separate Ukraine-related reporting');

  // If AI text contains high-risk specific claims not clearly supported by supplied headlines,
  // soften them into source-bound regional monitoring language.
  const unsupportedStrike = /\b(strike|strikes|airstrike|airstrikes|attack|attacks|missile|missiles)\b/i.test(out)
    && !/\b(strike|strikes|airstrike|airstrikes|attack|attacks|missile|missiles)\b/i.test(c);
  if(unsupportedStrike || isUnsupportedSpecific(out, corpus)){
    out = out.replace(/.*?(U\.S\.|US|United States).*?(Iran|Middle East).*?\.?$/i, 'Available public reporting indicates elevated military and diplomatic activity involving the U.S. and Iran, with details subject to verification.');
    out = out.replace(/.*?(Iran|Israel|Ukraine|Taiwan).*?(strike|attack|missile).*?\.?$/i, 'Available public signals indicate elevated regional tension, with specific military details subject to verification.');
  }

  return out;
}

function safeIntelText(text='', fallback='Public signals remain under monitoring.', corpus=''){
  let out = reliabilityRewrite(String(text || ''), corpus).replace(/\s+/g,' ').trim();
  if(!out) return fallback;
  if(isUnsupportedSpecific(out, corpus)) return fallback;

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
function getVerifiedSources(articles){
  const sources = [...new Set((articles||[]).map(a=>a.source).filter(Boolean))];
  const baseline = ['Reuters','AP','BBC','NHK','Al Jazeera'];
  const named = sources.filter(s=>baseline.includes(s));
  const other = sources.filter(s=>!baseline.includes(s) && !/^ORACLE/.test(s)).slice(0,4);
  return (named.length ? named : sources.filter(s=>!/^ORACLE/.test(s)).slice(0,5)).concat(other).filter((v,i,a)=>a.indexOf(v)===i).slice(0,8);
}

function normalizeSourceConfidence(sc, articles, meta){
  const report = Array.isArray(meta?.sourceReport) ? meta.sourceReport : [];
  const fromArticles = [...new Set((articles||[]).map(a=>a.source).filter(Boolean))];
  const availableFromReport = report.filter(r=>r.ok && r.count>0).map(r=>r.name);
  const limitedFromReport = report.filter(r=>!r.ok || r.count===0).map(r=>r.name);
  const available = [...new Set([...(Array.isArray(sc?.availableSources)?sc.availableSources:[]), ...availableFromReport, ...fromArticles])].filter(Boolean).slice(0,10);
  const limited = [...new Set([...(Array.isArray(sc?.limitedSources)?sc.limitedSources:[]), ...limitedFromReport])].filter(Boolean).slice(0,8);
  const note = meta?.degraded
    ? 'Multi-source monitoring is partially degraded; ORACLE is using available public feeds plus cached or baseline signals.'
    : 'Multi-source public monitoring is active across news, event, seismic, and space-weather feeds.';
  return {
    availableSources: available.length ? available : ['GDELT'],
    limitedSources: limited,
    note: safeIntelText(sc?.note || note, 'Source confidence is being monitored.', (articles||[]).map(a=>a.title).join(' '))
  };
}
function buildFacts(articles, llm, meta){
  // FACTS are intentionally not free-form AI prose. They are source-bound observations
  // generated directly from supplied article titles to prevent unsupported claims.
  const corpus = (articles||[]).map(a=>a.title).join(' ');
  const out = [];
  if(meta?.degraded) out.push('Source status: live public source retrieval is limited; cached or baseline signals may be used.');

  const seen = new Set();
  for(const a of (articles||[]).slice(0,10)){
    const src = a.source || 'Public source';
    let title = safeIntelText(a.title || 'Public signal under monitoring.', 'Public signal under monitoring.', corpus);
    title = title.replace(/\.$/,'');
    const fact = `${src}: ${title}.`;
    const key = fact.toLowerCase().replace(/[^a-z0-9]+/g,' ').slice(0,90);
    if(!seen.has(key)){
      seen.add(key);
      out.push(fact);
    }
    if(out.length >= 4) break;
  }

  if(out.length) return out;
  return ['Public signals are being monitored.'];
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

function buildEvidence(articles=[], meta={}, analyzed={}){
  const sources = getVerifiedSources(articles);
  const report = Array.isArray(meta?.sourceReport) ? meta.sourceReport : [];
  const active = report.filter(r=>r.ok && r.count>0).map(r=>r.name);
  const combined = [...new Set([...sources, ...active])].filter(Boolean).slice(0,10);
  const sourceCount = combined.length || sources.length || 1;
  const articleCount = articles.length || 0;
  const crossChecks = Math.max(1, Math.min(4, sourceCount - 1));
  const reliability = sourceHealthScore(articles, meta);
  return { sourceCount, sources: combined.length ? combined : ['Public sources'], articleCount, crossChecks, reliability };
}

function conciseBrief(aiBrief='', articles=[], topRegion='Global', score=0){
  const text = clean(aiBrief);
  if(text && text.length <= 135 && !isUnsupportedSpecific(text, (articles||[]).map(a=>a.title).join(' '))) return text.replace(/\s+/g,' ');
  const sources = getVerifiedSources(articles);
  const main = topRegion || 'Global';
  const state = score >= 50 ? 'elevated' : score >= 30 ? 'watch-level' : 'stable';
  if(sources.length >= 3) return `Multiple public sources indicate ${state} monitoring conditions, led by ${main}.`;
  return `Available public signals indicate ${state} monitoring conditions, led by ${main}.`;
}

function buildPayload(analyzed, articles, llm, meta={}){
  const score = analyzed.final;
  const state = stateFromScore(score);
  const top = analyzed.top || { title:'Public signals under monitoring', source:'GDELT', url:'https://www.gdeltproject.org/' };
  const topRegion = analyzed.regions[0]?.name || 'Global';
  const timeline = articles.slice(0,5).map((a,i)=>({ time: i===0?'NOW':`-${(i+1)*12}M`, text: `${a.source}: ${a.title.slice(0,115)}` }));
  const aiOk = Boolean(llm && !llm.error);
  const corpus = (articles||[]).map(a=>a.title).join(' ');

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
    sourceHealth: sourceHealthScore(articles, meta),
    facts: buildFacts(articles, llm, meta),
    outlook24h: aiOk ? normalizeOutlook(llm.outlook24h) : (score >= 50 ? 'WATCH' : 'STABLE'),
    outlookText: aiOk ? safeIntelText(llm.outlookText, 'Available public signals suggest conditions should continue to be monitored over the next 24 hours.', corpus) : 'Available public signals suggest conditions should continue to be monitored over the next 24 hours.',
    keyDrivers: aiOk ? safeList(llm.keyDrivers, topRegion, analyzed) : fallbackDrivers(topRegion, analyzed),
    watchNext: aiOk ? safeList(llm.watchNext, topRegion, analyzed) : fallbackWatchNext(topRegion),
    sourceConfidence: aiOk ? normalizeSourceConfidence(llm.sourceConfidence, articles, meta) : normalizeSourceConfidence(null, articles, meta),
    verifiedSources: aiOk && Array.isArray(llm.verifiedSources) ? llm.verifiedSources.slice(0,8) : getVerifiedSources(articles),
    evidence: buildEvidence(articles, meta, analyzed),
    articleCount: articles.length,
    brief: conciseBrief(aiOk ? safeIntelText(llm.brief, '', corpus) : '', articles, topRegion, score),
    assessment: aiOk ? safeIntelText(llm.assessment, `ORACLE assesses ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`, corpus) : `ORACLE assesses ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`,
    scoreReason: aiOk ? safeIntelText(llm.scoreReason, `Score reflects weighted public signals across military, diplomacy, cyber, logistics, finance and disaster categories, adjusted for limited global synchronization.`, corpus) : `Score reflects weighted public signals across military, diplomacy, cyber, logistics, finance and disaster categories, adjusted for limited global synchronization.`,
    xPost: aiOk ? safeIntelText(llm.xPostGlobal || llm.xPost, '', corpus) : null,
    xPostGlobal: aiOk ? safeIntelText(llm.xPostGlobal || llm.xPost, '', corpus) : null,
    xPostJapanese: aiOk ? safeIntelText(llm.xPostJapanese, '', corpus) : null,
    hashtags: aiOk ? safeHashtags(llm.hashtags) : null,
    topEvent: { title: top.title, summary: aiOk ? safeIntelText(llm.topSummary, `${topRegion} is currently the strongest contributor to the global risk index.`, corpus) : `${topRegion} is currently the strongest contributor to the global risk index.`, source: top.source || 'GDELT', url: top.url || 'https://www.gdeltproject.org/' },
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

function sourceHealthScore(articles, meta){
  const report = Array.isArray(meta?.sourceReport) ? meta.sourceReport : [];
  if(!report.length) return meta?.degraded ? 72 : (articles.length > 10 ? 92 : 82);
  const active = report.filter(r=>r.ok && r.count>0).length;
  const total = Math.max(report.length,1);
  const volume = Math.min((articles||[]).length,80) / 80;
  return clamp(Math.round(55 + (active/total)*28 + volume*13), 55, 98);
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
    sourceConfidence:{availableSources:['GDELT','Google News','USGS','NOAA'],limitedSources:['Guardian optional'],note:'Live public source retrieval is degraded; ORACLE can use multiple free public feeds plus baseline signals.'},
    verifiedSources:['GDELT','Google News','USGS','NOAA'], evidence:{sourceCount:4, sources:['GDELT','Google News','USGS','NOAA'], articleCount:0, crossChecks:2, reliability:72}, articleCount:0,
    topEvent:{ title:'Public source monitoring active', summary:'No dominant global escalation signal is available from current public inputs.', source:'GDELT', url:'https://www.gdeltproject.org/' },
    drivers:{ Military:38, Diplomatic:26, Cyber:18, Logistics:12, Finance:10, Disaster:7 }, weights:WEIGHTS, calculation:{ raw:31.9, containment:-3.9, final:28 },
    regions:[{name:'Ukraine',score:44,change:'+1',trend:'Watch'},{name:'Taiwan Strait',score:39,change:'0',trend:'Watch'},{name:'Middle East',score:37,change:'0',trend:'Stable'},{name:'South China Sea',score:31,change:'0',trend:'Stable'},{name:'Korea',score:25,change:'0',trend:'Stable'}],
    timeline:[{time:'NOW',text:'Fallback monitoring mode active.'}], metrics:{ conflicts:'7', conflictsSub:'+1 / 24H · MONITORED', flights:'WATCH', flightsSub:'PUBLIC SIGNALS', cyber:'WATCH', cyberSub:'LOW SURGE', logistics:'STABLE', logisticsSub:'CONTAINED' }
  };
}
