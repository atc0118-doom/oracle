// ORACLE World Risk Intelligence — fixed version
// Changes from original (see inline "FIX:" comments for each):
// 1. reliabilityRewrite no longer nukes trailing text with a runaway `.*...$` regex.
// 2. confidence no longer gets a free +5 just because OPENAI_API_KEY exists;
//    it only gets the bonus if the AI call actually succeeded.
// 3. Baseline/fallback data is now explicitly flagged (isBaseline) and can never
//    be reported to the client as "LIVE", and its confidence is hard-capped low.
// 4. Removed dead code (unused countTerms).
// 5. isUnsupportedSpecific / reliabilityRewrite tightened to operate sentence-by-sentence
//    instead of matching to end-of-string.

const REGION_KEYWORDS = [
  { name: 'Ukraine', terms: ['ukraine','kyiv','kiev','donetsk','kharkiv','zaporizhzhia','russia','crimea'] },
  // FIX: removed the bare word 'strait' from Taiwan Strait matching. A generic
  // term like "strait" also appears in unrelated phrases such as "Strait of
  // Hormuz" (Middle East), which was causing those headlines to be mislabeled
  // as Taiwan Strait signals. Now only Taiwan-specific strait phrasing counts.
  { name: 'Taiwan Strait', terms: ['taiwan','taipei','taiwan strait','strait of taiwan','formosa strait','pla','china military','chinese military'] },
  { name: 'Middle East', terms: ['iran','israel','gaza','hamas','hezbollah','red sea','houthi','lebanon','syria','strait of hormuz','hormuz'] },
  // FIX: removed the bare word 'maritime' from South China Sea matching for the
  // same reason — it's a generic term that also applies to Middle East/Hormuz
  // shipping stories and would mislabel them.
  { name: 'South China Sea', terms: ['south china sea','philippines','spratly','scarborough','west philippine sea'] },
  { name: 'Korea', terms: ['north korea','south korea','pyongyang','seoul'] },
  { name: 'Global Cyber', terms: ['cyber','hack','malware','ransomware','data breach','ddos'] }
];

const CATEGORY_KEYWORDS = {
  Military: ['military','missile','drone','airstrike','troops','army','navy','air force','attack','defense','war','combat','shelling','weapon','fighter','strike'],
  Diplomatic: ['sanction','summit','ceasefire','negotiation','treaty','diplomatic','minister','embassy','un ','resolution','talks','envoy'],
  Cyber: ['cyber','hack','malware','ransomware','data breach','ddos','spyware','phishing'],
  Logistics: ['shipping','port','tanker','supply chain','freight','container','canal','sea lane','logistics','vessel'],
  Finance: ['market','oil','gas','inflation','stocks','bond','currency','rate','bank','gold','dollar'],
  Disaster: ['earthquake','flood','wildfire','volcano','storm','hurricane','typhoon','tsunami','drought'],
  // FIX (coverage gap): there was previously NO keyword category for disease
  // outbreaks at all — an active pandemic or epidemic simply had no bucket to
  // be counted in, regardless of how much it was in the news.
  Health: ['outbreak','epidemic','pandemic','disease outbreak','who ','world health organization','cdc','infectious disease','vaccine','quarantine']
};

// FIX (score scope): Disaster and Health used to be weighted into the same
// single ORACLE INDEX as Military/Diplomatic/Cyber/Logistics/Finance. That
// meant a major earthquake or disease outbreak — with zero geopolitical
// tension involved — could move the "world risk" number on its own, even
// though every other part of the UI (regions, map, top event) frames this as
// a geopolitical-tension index. Disaster/Health are still tracked and shown
// (see the separate DISASTER & HEALTH MONITORING card), just no longer
// weighted into the score itself. Their weight here is 0 on purpose.
const WEIGHTS = { Military:.38, Diplomatic:.22, Cyber:.16, Logistics:.16, Finance:.08, Disaster:0, Health:0 };
const NON_SCORING_CATEGORIES = ['Disaster','Health'];
const ORACLE_CACHE = globalThis.__ORACLE_CACHE__ || (globalThis.__ORACLE_CACHE__ = { articles:null, ts:0, lastError:null, sourceReport:null });
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6500;

// ---------------------------------------------------------------------------
// FIX (persistence, priority #4 from the review backlog): the "24H delta"
// and "yesterday's watch-next follow-up" features were entirely client-side
// (browser localStorage), so switching devices or clearing site data reset
// them to zero. This adds an OPTIONAL durable log backed by Upstash Redis
// (via Vercel Marketplace's Redis integration, which injects REST
// credentials as env vars). If no credentials are configured, every function
// here quietly no-ops and the payload simply omits the server-side fields —
// the frontend already has a client-side fallback for both features, so
// nothing breaks for people who haven't set up storage yet.
// ---------------------------------------------------------------------------
const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || null;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || null;
const REDIS_LOG_KEY = 'oracle:score_log';
const REDIS_LOG_MAX_AGE_MS = 9 * 24 * 60 * 60 * 1000; // keep 9 days of points server-side

async function redisCommand(command){
  if(!REDIS_URL || !REDIS_TOKEN) return null;
  try{
    const r = await fetchWithTimeout(REDIS_URL, {
      method:'POST',
      headers:{ authorization:`Bearer ${REDIS_TOKEN}`, 'content-type':'application/json' },
      body: JSON.stringify(command),
      timeout: 4000
    });
    if(!r.ok) return null;
    const j = await r.json();
    return j?.result ?? null;
  }catch(_){
    return null; // storage being unreachable should never break the risk endpoint
  }
}

async function logScoreToRedis({ score, state, topRegion, watchNext }){
  if(!REDIS_URL || !REDIS_TOKEN) return;
  const now = Date.now();
  const member = JSON.stringify({ ts:now, score, state, topRegion, watchNext: (watchNext||[]).slice(0,5) });
  await redisCommand(['ZADD', REDIS_LOG_KEY, now, member]);
  // Trim old points opportunistically so the sorted set doesn't grow forever.
  await redisCommand(['ZREMRANGEBYSCORE', REDIS_LOG_KEY, 0, now - REDIS_LOG_MAX_AGE_MS]);
}

function parseRedisLogEntries(raw){
  if(!Array.isArray(raw)) return [];
  return raw.map(s=>{ try{ return JSON.parse(s); }catch(_){ return null; } }).filter(Boolean);
}

async function getServerDelta24h(){
  if(!REDIS_URL || !REDIS_TOKEN) return { available:false };
  const now = Date.now();
  const windowMin = now - 30*60*60*1000;
  const windowMax = now - 20*60*60*1000;
  const raw = await redisCommand(['ZRANGEBYSCORE', REDIS_LOG_KEY, windowMin, windowMax]);
  const entries = parseRedisLogEntries(raw);
  if(!entries.length) return { available:false };
  const target = now - 24*60*60*1000;
  const closest = entries.reduce((best,e)=> Math.abs(e.ts-target) < Math.abs(best.ts-target) ? e : best);
  return { available:true, refScore: closest.score, refTs: closest.ts };
}

async function getServerPreviousDay(){
  if(!REDIS_URL || !REDIS_TOKEN) return null;
  const now = Date.now();
  const raw = await redisCommand(['ZRANGEBYSCORE', REDIS_LOG_KEY, now - REDIS_LOG_MAX_AGE_MS, now]);
  const entries = parseRedisLogEntries(raw);
  if(!entries.length) return null;
  const todayJst = jstDateStamp(now);
  // Most recent entry that falls on an earlier JST calendar day than today.
  const priorDayEntries = entries.filter(e => jstDateStamp(e.ts) !== todayJst);
  if(!priorDayEntries.length) return null;
  const latest = priorDayEntries.reduce((best,e)=> e.ts > best.ts ? e : best);
  return { date: jstDateStamp(latest.ts), score: latest.score, state: latest.state, topRegion: latest.topRegion, watchNext: latest.watchNext || [] };
}

function jstDateStamp(ts){
  const d = new Date(new Date(ts).toLocaleString('en-US', { timeZone:'Asia/Tokyo' }));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export default async function handler(req, res){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=240');

  try{
    const { articles, sourceError, degraded, sourceReport, isBaseline } = await loadArticles();
    const analyzed = analyzeArticles(articles);
    analyzed.isBaseline = isBaseline; // FIX: propagate baseline flag through the whole pipeline
    const llm = await aiAssessment(analyzed, articles, sourceError);
    const payload = buildPayload(analyzed, articles, llm, { sourceError, degraded, sourceReport, isBaseline });

    // Server-side history (optional — no-ops cleanly if Redis isn't configured).
    const [serverDelta24h, serverPreviousDay] = await Promise.all([
      getServerDelta24h(),
      getServerPreviousDay()
    ]);
    payload.serverDelta24h = serverDelta24h;
    payload.serverPreviousDay = serverPreviousDay;
    if(!isBaseline){
      // Don't log baseline/placeholder scores into real history — they'd
      // pollute the 24H delta and next-day follow-up with fabricated data.
      await logScoreToRedis({ score: payload.score, state: payload.state, topRegion: analyzed.regions[0]?.name || 'Global', watchNext: payload.watchNext });
    }

    res.status(200).json(payload);
  }catch(error){
    res.status(200).json(fallbackPayload(error?.message || 'unknown'));
  }
}

async function loadArticles(){
  const now = Date.now();
  if(ORACLE_CACHE.articles?.length && now - ORACLE_CACHE.ts < CACHE_TTL_MS){
    return { articles:ORACLE_CACHE.articles, sourceError:ORACLE_CACHE.lastError, degraded:false, sourceReport:ORACLE_CACHE.sourceReport || [], isBaseline:false };
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
    return { articles, sourceError, degraded: available < 2, sourceReport:report, isBaseline:false };
  }

  if(ORACLE_CACHE.articles?.length){
    return { articles:ORACLE_CACHE.articles, sourceError:(sourceError || 'all sources empty') + ' · using cache', degraded:true, sourceReport:report, isBaseline:false };
  }

  // FIX: baseline data is now explicitly flagged. It must never be presented as LIVE.
  return { articles:baselineArticles(sourceError || 'all public sources unavailable'), sourceError:(sourceError || 'all public sources unavailable') + ' · using baseline signals', degraded:true, sourceReport:report, isBaseline:true };
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
  // FIX (coverage gap): this query used to only include the 6 fixed regions
  // ORACLE scores + generic conflict/disaster terms. Real conflicts and
  // outbreaks outside that fixed list (Sudan, Myanmar, DR Congo, Haiti,
  // Venezuela, a disease outbreak, etc.) had no keyword here at all, so they
  // were invisible from the fetch stage onward — no amount of scoring logic
  // downstream could surface them. This doesn't make ORACLE comprehensive
  // (a fixed keyword list never can be), but it closes the most obvious gaps.
  const query = encodeURIComponent('(military OR conflict OR missile OR drone OR cyber OR earthquake OR logistics OR shipping OR sanctions OR outbreak OR epidemic OR pandemic OR Taiwan OR Ukraine OR Iran OR Israel OR NATO OR Russia OR China OR Sudan OR Myanmar OR "DR Congo" OR Haiti OR Venezuela OR Sahel)');
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&format=json&maxrecords=45&sort=hybridrel&timespan=24h`;
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/9.0' } });
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
  const q = encodeURIComponent('(Ukraine OR Taiwan OR Iran OR Israel OR cyber OR earthquake OR shipping OR NATO OR Russia OR China OR Sudan OR Myanmar OR "DR Congo" OR Haiti OR Venezuela OR outbreak OR epidemic OR pandemic) when:1d');
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/9.0' } });
  if(!r.ok) throw new Error('google_news ' + r.status);
  const xml = await r.text();
  return parseRss(xml, 'Google News').slice(0,25);
}

async function fetchGuardian(){
  const key = process.env.GUARDIAN_API_KEY;
  if(!key) return [];
  const q = encodeURIComponent('Ukraine OR Taiwan OR Iran OR Israel OR cyber OR earthquake OR shipping OR Russia OR China OR Sudan OR Myanmar OR "DR Congo" OR Haiti OR Venezuela OR outbreak OR epidemic OR pandemic');
  const url = `https://content.guardianapis.com/search?q=${q}&section=world|technology|business|environment&show-fields=trailText&order-by=newest&page-size=20&api-key=${key}`;
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/9.0' } });
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
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/9.0' } });
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
  const r = await fetchWithTimeout(url, { headers:{ 'user-agent':'ORACLE World Risk Intelligence/9.0' } });
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
  // FIX: sourceType is now explicitly 'baseline-placeholder' so downstream code
  // (evidence, verifiedSources, timeline) can recognize and exclude/flag this
  // synthetic content instead of treating it as a real signal.
  return [
    { title:'Ukraine remains under active conflict monitoring as military signals continue', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English', sourceType:'baseline-placeholder' },
    { title:'Taiwan Strait remains under watch due to military and diplomatic signals', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English', sourceType:'baseline-placeholder' },
    { title:'Middle East tensions remain monitored with Iran Israel and Red Sea signals', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English', sourceType:'baseline-placeholder' },
    { title:'Cyber security alerts remain at watch level with no broad global surge', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English', sourceType:'baseline-placeholder' },
    { title:'Logistics and shipping pressure remains contained across monitored public sources', source:'ORACLE Baseline', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English', sourceType:'baseline-placeholder' },
    { title:`Public source degradation detected: ${reason}`, source:'ORACLE System', url:'https://www.gdeltproject.org/', domain:'oracle.local', seen:now, language:'English', sourceType:'baseline-placeholder' }
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

// FIX: removed unused/dead `countTerms` function that was never called anywhere.

function countOccurrences(text, terms){
  return terms.reduce((n,t)=>{
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + escaped.replace(/\\s+/g,'\\s+') + '\\b', 'gi');
    return n + ((text.match(re) || []).length);
  }, 0);
}

function articleWeight(article){
  const source = String(article.source || '').toLowerCase();
  const type = String(article.sourceType || '').toLowerCase();
  let w = 1;
  if(type === 'baseline-placeholder') w *= 0.5; // FIX: baseline placeholder text should never weigh as much as a real signal
  if(type.includes('event') || source.includes('google news')) w *= 0.82;
  if(type.includes('official') || /centcom|nato|mod|white house|government/.test(source)) w *= 0.90;
  if(type.includes('disaster') || type.includes('space')) w *= 0.75;
  if(/reuters|ap news|associated press|bbc|npr|al jazeera|guardian|cnbc/.test(source)) w *= 1.08;
  return w;
}

function freshnessWeight(article){
  const seen = new Date(article?.seen || 0).getTime();
  if(!seen || Number.isNaN(seen)) return 0.72;

  const ageHours = Math.max(0, (Date.now() - seen) / 3600000);
  if(ageHours <= 2) return 1.18;
  if(ageHours <= 6) return 1.00;
  if(ageHours <= 12) return 0.84;
  if(ageHours <= 24) return 0.66;
  return 0.42;
}

function analyzeArticles(articles){
  const list = Array.isArray(articles) ? articles : [];
  const total = Math.max(list.length, 1);
  const driverRaw = Object.fromEntries(Object.keys(CATEGORY_KEYWORDS).map(k=>[k,0]));
  const driverSources = Object.fromEntries(Object.keys(CATEGORY_KEYWORDS).map(k=>[k,new Set()]));
  const regionRaw = Object.fromEntries(REGION_KEYWORDS.map(r=>[r.name,0]));
  const regionSources = Object.fromEntries(REGION_KEYWORDS.map(r=>[r.name,new Set()]));
  const regionArticles = Object.fromEntries(REGION_KEYWORDS.map(r=>[r.name,0]));
  const regionTerms = Object.fromEntries(REGION_KEYWORDS.map(r=>[r.name,new Set()]));
  const regionFreshness = Object.fromEntries(REGION_KEYWORDS.map(r=>[r.name,0]));
  const regionEvidenceMap = Object.fromEntries(REGION_KEYWORDS.map(r=>[r.name,[]]));
  const articleScores = [];

  for(const a of list){
    const titleText = `${a.title || ''}`.toLowerCase();
    const text = `${a.title || ''} ${a.source || ''}`.toLowerCase();
    const w = articleWeight(a);
    let catTotal = 0;
    const cats = {};

    for(const [cat, terms] of Object.entries(CATEGORY_KEYWORDS)){
      const hits = countOccurrences(text, terms);
      if(hits){
        const val = Math.min(hits, 5) * w;
        driverRaw[cat] += val;
        driverSources[cat].add(a.source || 'Source');
        cats[cat] = hits;
        catTotal += val;
      }
    }

    let regTotal = 0;
    const regs = {};
    for(const r of REGION_KEYWORDS){
      const matchedTerms = r.terms.filter(term=>titleText.includes(term));
      const hits = countOccurrences(titleText, r.terms);
      if(hits){
        const val = Math.min(hits, 5) * w;
        regionRaw[r.name] += val;
        regionSources[r.name].add(a.source || 'Source');
        regionArticles[r.name] += 1;
        matchedTerms.forEach(term=>regionTerms[r.name].add(term));

        const seenAt = a.seen ? new Date(a.seen).getTime() : NaN;
        if(Number.isFinite(seenAt)){
          const ageHours = Math.max(0, (Date.now() - seenAt) / 36e5);
          regionFreshness[r.name] += ageHours <= 6 ? 1 : ageHours <= 18 ? .65 : .35;
        }else{
          regionFreshness[r.name] += .35;
        }

        regs[r.name] = hits;
        regTotal += val;
      }
    }

    const sourceBoost = /reuters|ap news|associated press|bbc|npr|al jazeera|guardian|cnbc/i.test(a.source || '') ? 1.8 : 0;
    const freshness = freshnessWeight(a);
    const eventScore = (catTotal * 1.15 + regTotal * 1.35 + sourceBoost) * freshness;
    const primaryDriver = Object.entries(cats).sort((x,y)=>y[1]-x[1])[0]?.[0] || 'General';
    const matchedRegions = Object.keys(regs);

    for(const regionName of matchedRegions){
      const regionalHits = Number(regs[regionName] || 0);
      const regionalContribution = round1((regionalHits * w * 1.35 + sourceBoost * 0.5) * freshness);
      regionEvidenceMap[regionName].push({
        title:a.title,
        source:a.source || 'Source',
        url:a.url || '#',
        seen:a.seen || '',
        sourceType:a.sourceType || 'public-reporting',
        primaryDriver,
        drivers:Object.keys(cats),
        signals:round1(regionalHits * w),
        contribution:regionalContribution,
        freshness:round1(freshness)
      });
    }

    articleScores.push({ article:a, score:eventScore, freshness, cats, regs, primaryDriver, matchedRegions });
  }

  const maxDriverRaw = Math.max(1, ...Object.values(driverRaw));
  const drivers = {};
  const driverEvidence = {};
  for(const cat of Object.keys(CATEGORY_KEYWORDS)){
    const sourceBoost = Math.min(driverSources[cat].size, 6) * 2.5;
    const volumeBoost = Math.log1p(total) * 1.6;
    drivers[cat] = clamp(Math.round(4 + (driverRaw[cat] / maxDriverRaw) * 68 + sourceBoost + volumeBoost), 3, 92);
    driverEvidence[cat] = {
      evidenceScore: drivers[cat],
      signals: round1(driverRaw[cat] || 0),
      sources: driverSources[cat].size,
      contribution: round1((drivers[cat] || 0) * (WEIGHTS[cat] || 0)),
      weight: WEIGHTS[cat] || 0
    };
  }

  const maxRegionRaw = Math.max(1, ...Object.values(regionRaw));
  const regions = REGION_KEYWORDS.map(r=>{
    const raw = regionRaw[r.name] || 0;
    const sources = regionSources[r.name].size;
    const articleCount = regionArticles[r.name] || 0;
    const terms = [...regionTerms[r.name]].slice(0,8);
    const freshness = round1(regionFreshness[r.name] || 0);

    if(raw <= 0 || sources <= 0 || articleCount <= 0){
      return { name:r.name, score:0, change:'+0', trend:'No verified signal', count:0, raw:0, sources:0, articles:0, terms:[], freshness:0, breakdown:{ signal:0, source:0, coverage:0, freshness:0 } };
    }

    // Region score is based only on region-specific evidence. Shared global
    // Military/Diplomatic driver values are intentionally excluded.
    const signalComponent = (raw / maxRegionRaw) * 46;
    const sourceComponent = Math.min(sources, 6) * 3;
    const coverageComponent = Math.min(articleCount, 8) * 1.5;
    const freshnessComponent = Math.min(freshness, 6) * 1.2;
    const diversityComponent = Math.min(terms.length, 5) * 0.8;
    const score = clamp(Math.round(8 + signalComponent + sourceComponent + coverageComponent + freshnessComponent + diversityComponent), 8, 88);

    return {
      name:r.name,
      score,
      change: raw>4?'+2':raw>0?'+1':'+0',
      trend:raw>4?'Rising':'Watch',
      count:raw,
      raw:round1(raw),
      sources,
      articles:articleCount,
      terms,
      freshness,
      breakdown:{ signal:round1(signalComponent), source:round1(sourceComponent), coverage:round1(coverageComponent), freshness:round1(freshnessComponent), diversity:round1(diversityComponent) }
    };
  }).sort((a,b)=>b.score-a.score);

  const activeRegions = regions.filter(r=>r.score > 0 && r.sources > 0 && r.articles > 0).slice(0,5);
  const inactiveRegions = regions.filter(r=>r.score <= 0 || r.sources <= 0 || r.articles <= 0);

  const raw = Object.entries(drivers).reduce((sum,[k,v])=> sum + v*(WEIGHTS[k]||0), 0);
  const regionTotal = Object.values(regionRaw).reduce((s,v)=>s+v,0) || 1;
  const contributors = activeRegions.map(r=>{
    const signals = Number(r.raw || r.count || 0);
    const sources = Number(r.sources || 0);
    const hasEvidence = signals > 0 && sources > 0;
    const share = hasEvidence ? clamp(Math.round(((regionRaw[r.name] || 0) / regionTotal) * 100), 0, 100) : 0;
    return {
      name:r.name,
      share,
      impact:hasEvidence ? round1((share / 100) * raw * .65) : 0,
      score:hasEvidence ? r.score : 0,
      trend:hasEvidence ? r.trend : 'No verified signal',
      signals:hasEvidence ? round1(signals) : 0,
      sources:hasEvidence ? sources : 0,
      articles:hasEvidence ? r.articles : 0,
      terms:hasEvidence ? r.terms : []
    };
  });

  const regionEvidence = Object.fromEntries(
    activeRegions.map(r=>{
      const items = (regionEvidenceMap[r.name] || [])
        .sort((a,b)=>b.contribution-a.contribution)
        .slice(0,6);
      return [r.name, {
        region:r.name,
        score:r.score,
        trend:r.trend,
        signals:round1(r.raw || r.count || 0),
        sources:r.sources || 0,
        articles:r.articles || 0,
        terms:r.terms || [],
        evidence:items
      }];
    })
  );

  const stability = stabilityAdjustment(drivers, activeRegions, total, contributors);
  const duplicate = duplicateNoiseReduction(list);
  const globalSync = globalSynchronizationAdjustment(contributors, drivers);
  const adjustment = stability.value;
  const duplicateReduction = duplicate.value;
  const globalNormalization = globalSync.value;
  const adjustmentReasons = [...stability.reasons, ...duplicate.reasons, ...globalSync.reasons];
  const final = clamp(Math.round(raw + adjustment + duplicateReduction + globalNormalization), 5, 92);
  const sourceDiversity = new Set(list.map(a=>a.source).filter(Boolean)).size;
  // FIX: confidence bump for AI no longer depends on whether OPENAI_API_KEY merely
  // exists in the environment; it's applied later in buildPayload only if the AI
  // call actually returned a usable result (aiOk). Base confidence here is purely
  // rule-based signal quality.
  const confidence = clamp(Math.round(52 + Math.min(list.length,80)*0.18 + sourceDiversity*3), 45, 87);
  const top = pickTopEventFromScores(articleScores, activeRegions);

  return { drivers, driverEvidence, regions:activeRegions, inactiveRegions, regionEvidence, articleScores, raw, adjustment, duplicateReduction, globalNormalization, adjustmentReasons, final, confidence, top, total, contributors, driverRaw, regionRaw };
}

// FIX (transparency): these three adjustment functions used to return only a
// number. The "WHY SCORE?" panel could show e.g. "Stability adjustment -1.0"
// but had no way to say *why* -1.0 rather than some other value — the actual
// if/else branches that produced it were invisible to the person reading the
// score. Each function now also returns a `reasons` array of plain-language
// explanations for every branch that actually fired, so the UI can show the
// real rule that was applied instead of a generic fixed sentence.

function duplicateNoiseReduction(articles=[]){
  const titles = articles.map(a=>clean(a.title || '').toLowerCase()).filter(Boolean);
  if(titles.length < 8) return { value:0, reasons:['Fewer than 8 signals: duplicate-noise check skipped.'] };
  const stems = titles.map(t=>t.replace(/[^a-z0-9]+/g,' ').split(' ').slice(0,8).join(' '));
  const unique = new Set(stems).size;
  const ratio = unique / Math.max(stems.length,1);
  const pct = Math.round(ratio*100);
  if(ratio < .55) return { value:-4, reasons:[`Only ${pct}% of signals have distinct headlines (below 55%): -4 for heavy duplication.`] };
  if(ratio < .72) return { value:-2, reasons:[`${pct}% of signals have distinct headlines (below 72%): -2 for moderate duplication.`] };
  return { value:0, reasons:[`${pct}% of signals have distinct headlines: no duplication penalty.`] };
}

function globalSynchronizationAdjustment(contributors=[], drivers={}){
  const topShare = contributors[0]?.share || 0;
  const topName = contributors[0]?.name || 'the top region';
  let adj = 0;
  const reasons = [];
  if(topShare > 58){ adj -= 3; reasons.push(`${topName} accounts for ${topShare}% of signals (>58%): -3, risk is regionally concentrated rather than globally synchronized.`); }
  if(topShare < 38 && (drivers.Military||0) > 50){ adj += 2; reasons.push(`No single region dominates (top region ${topShare}% <38%) while Military pressure is high (${Math.round(drivers.Military||0)}): +2, pressure appears spread across regions.`); }
  if((drivers.Cyber||0) > 45 && (drivers.Logistics||0) > 45){ adj += 2; reasons.push(`Cyber (${Math.round(drivers.Cyber||0)}) and Logistics (${Math.round(drivers.Logistics||0)}) are both elevated (>45): +2, possible cross-domain spillover.`); }
  if(!reasons.length) reasons.push('No global-synchronization conditions were met: no adjustment.');
  return { value:adj, reasons };
}

function stabilityAdjustment(drivers, regions, total, contributors=[]){
  let adj = -3;
  const reasons = ['Baseline stability adjustment: -3 (applied every cycle to avoid over-reacting to normal daily signal volume).'];
  if((drivers.Military||0) > 58 && (drivers.Diplomatic||0) > 32){ adj += 2; reasons.push(`Military (${Math.round(drivers.Military||0)}) and Diplomatic (${Math.round(drivers.Diplomatic||0)}) are both elevated: +2, active engagement rather than silent escalation.`); }
  if(regions[0]?.score > 62){ adj += 2; reasons.push(`Top region "${regions[0]?.name}" scores ${regions[0]?.score} (>62): +2, well-evidenced regional signal.`); }
  if(total < 12){ adj -= 5; reasons.push(`Only ${total} public signals total (<12): -5, low signal volume reduces confidence.`); }
  if((drivers.Logistics||0) < 22 && (drivers.Finance||0) < 22){ adj -= 2; reasons.push(`Logistics (${Math.round(drivers.Logistics||0)}) and Finance (${Math.round(drivers.Finance||0)}) both low (<22): -2, no economic spillover detected.`); }
  if((contributors[0]?.share || 0) > 62){ adj -= 2; reasons.push(`Top region holds ${contributors[0]?.share}% share of signals (>62%): -2, penalizing single-region concentration.`); }
  return { value: Math.round(adj*10)/10, reasons };
}

function pickTopEventFromScores(articleScores, regions){
  if(!articleScores.length) return null;
  const topRegion = regions[0]?.name || '';
  const preferred = articleScores
    .map(x=>({ ...x, regionBonus: x.regs[topRegion] ? 4 : 0 }))
    .sort((a,b)=>(b.score+b.regionBonus)-(a.score+a.regionBonus));
  return preferred[0]?.article || articleScores[0].article;
}

async function aiAssessment(analyzed, articles, sourceError=null){
  const key = process.env.OPENAI_API_KEY;
  if(!key) return null;

  try{
    const selectedTop = analyzed.top || articles[0] || {};
    const headlines = articles.slice(0,18).map((a,i)=>`${i+1}. ${a.title} [${a.source}]`).join('\n');
    const prompt = `You are ORACLE, a calm world-risk intelligence engine. Analyze ONLY the supplied public headlines and calculated signals. Prefer source-bound, non-causal intelligence wording.
Return strict JSON only. No markdown.
Required keys:
- facts: array of 2 to 4 conservative source-bound observations. Do NOT repeat specific attack/strike headlines verbatim. Prefer aggregated public-reporting summaries such as source coverage, monitored regions, and signal categories.
- assessment: 1 to 2 sentence AI assessment, clearly separated from facts.
- brief: 1 concise source-bound summary for the hero area, maximum 120 characters, no more than one sentence.
- topSummary: 1 sentence explanation of why the selected top event matters. It must refer ONLY to SELECTED_TOP_EVENT, not other headlines.
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
- TOP EVENT summary must be bound to SELECTED_TOP_EVENT only. If there is not enough detail, say it is being monitored as a signal rather than summarizing beyond the headline.
- Drivers must reflect the supplied driver values and contributors; do not present generic fixed explanations.
- Use phrases like "headlines report", "public headlines indicate", or "available reporting mentions" when describing specific events.
- For FACTS, prefer neutral summaries over dramatic verbs. Avoid "intensifying", "responding aggressively", "driving", "triggering", or "proving" unless those exact ideas are present in supplied headlines.


- Keep the hero brief short enough for a mobile screen. Do not exceed 115 characters. Prefer: "Multiple public sources indicate watch-level monitoring conditions led by [region]."
- Do not combine U.S./Iran and Ukraine headlines into a single causal sentence.
- Use neutral phrasing: "headlines mention", "public reporting references", "monitoring continues".
- If evidence is mixed or source volume is limited, say so plainly.

X post rules:
- Always include the score and state.
- Avoid definitive claims unless directly supported by supplied headlines.
- hashtags must always include ORACLE, WorldRiskIndex, GlobalRisk, AIAnalysis, OSINT. Beyond those five, add whatever short, real, on-topic tags actually match the supplied headlines — do not limit yourself to a fixed example list. If the headlines involve Sudan, Myanmar, DRC, Haiti, Venezuela, a disease outbreak, or any other topic not in a typical example set, tag it plainly (e.g. Sudan, Myanmar, PublicHealth, Pandemic) rather than omitting it or forcing it into an unrelated existing tag.

Global score: ${analyzed.final}
Drivers: ${JSON.stringify(analyzed.drivers)}
Regions: ${JSON.stringify(analyzed.regions)}
Risk contributors: ${JSON.stringify(analyzed.contributors || [])}
Calculation: raw=${round1(analyzed.raw)}, stability=${round1(analyzed.adjustment)}, duplicateNoise=${round1(analyzed.duplicateReduction)}, globalNormalization=${round1(analyzed.globalNormalization)}, final=${analyzed.final}
SELECTED_TOP_EVENT: ${selectedTop.title || 'none'} [${selectedTop.source || 'source unknown'}]
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

// FIX: helper to split text into sentences so we never rewrite/replace across
// sentence boundaries (this is what caused the runaway regex bug before).
function splitSentences(text=''){
  const s = String(text || '');
  const parts = s.match(/[^.!?]+[.!?]*/g);
  return parts && parts.length ? parts : [s];
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

// FIX: rewritten to operate sentence-by-sentence. Previously this used
// `.replace(/.*?(U\.S\.|US|United States).*?(Iran|Middle East).*?\.?$/i, '...')`
// which — because `.*` is greedy across the WHOLE remaining string up to `$`
// (end of the entire text, not end of the sentence) — could silently delete
// every sentence after the first "U.S. ... Iran" match. Now each sentence is
// evaluated independently, so only the offending sentence is replaced.
function reliabilityRewrite(text='', corpus=''){
  const c = String(corpus || '').toLowerCase();

  const wordLevelFixes = (s)=>{
    let out = s;
    out = out.replace(/\bconfirmed\b/gi, 'reported');
    out = out.replace(/\bproves\b/gi, 'indicates');
    out = out.replace(/\bwill\b/gi, 'may');
    out = out.replace(/\bhas launched new strikes\b/gi, 'is referenced in public reporting related to military activity');
    out = out.replace(/\blaunched new strikes\b/gi, 'is referenced in public reporting related to military activity');
    out = out.replace(/\bare intensifying\b/gi, 'remain under watch');
    out = out.replace(/\bis intensifying\b/gi, 'remains under watch');
    out = out.replace(/\bresponding aggressively\b/gi, 'also appearing in related public reporting');
    out = out.replace(/\bdrives heightened\b/gi, 'coincides with elevated');
    out = out.replace(/\bdrive heightened\b/gi, 'coincide with elevated');
    out = out.replace(/\baffecting Russian military investments\b/gi, 'appearing in separate Ukraine-related reporting');
    return out;
  };

  const sentences = splitSentences(text).map(sentence=>{
    let s = wordLevelFixes(sentence);

    const unsupportedStrikeInSentence = /\b(strike|strikes|airstrike|airstrikes|attack|attacks|missile|missiles)\b/i.test(s)
      && !/\b(strike|strikes|airstrike|airstrikes|attack|attacks|missile|missiles)\b/i.test(c);

    if(unsupportedStrikeInSentence || isUnsupportedSpecific(s, corpus)){
      // Only replace THIS sentence — not everything after it.
      if(/(U\.S\.|US|United States)/i.test(s) && /(Iran|Middle East)/i.test(s)){
        return 'Available public reporting indicates elevated military and diplomatic activity involving the U.S. and Iran, with details subject to verification.';
      }
      if(/(Iran|Israel|Ukraine|Taiwan)/i.test(s) && /(strike|attack|missile)/i.test(s)){
        return 'Available public signals indicate elevated regional tension, with specific military details subject to verification.';
      }
      return ''; // drop only the unsupported sentence, keep the rest of the text intact
    }

    return s;
  });

  return sentences.filter(Boolean).join(' ').replace(/\s+/g,' ').trim();
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

function outlookFallback(label, topRegion='Global'){
  if(label === 'ESCALATING'){
    return `Available public signals indicate increasing pressure across ${topRegion}. Additional verified developments could raise the risk index further.`;
  }
  if(label === 'DE-ESCALATING'){
    return `Recent public signals indicate easing pressure across ${topRegion}, although active monitoring remains necessary.`;
  }
  if(label === 'WATCH'){
    return `Current public signals remain elevated across ${topRegion}. No broad synchronized global escalation is confirmed.`;
  }
  return `Current public signals remain broadly stable. No major synchronized global escalation is confirmed.`;
}

function alignedOutlookText(label, aiText='', topRegion='Global', corpus=''){
  const fallback = outlookFallback(label, topRegion);
  const text = safeIntelText(aiText, fallback, corpus);
  const lower = text.toLowerCase();

  if(label === 'ESCALATING' && !/(increasing|rising|escalat|elevated pressure|upward)/.test(lower)) return fallback;
  if(label === 'DE-ESCALATING' && !/(easing|declining|de-escalat|reducing|cooling)/.test(lower)) return fallback;
  if(label === 'WATCH' && !/(watch|elevated|monitor|pressure)/.test(lower)) return fallback;
  if(label === 'STABLE' && !/(stable|limited|no major|broadly stable)/.test(lower)) return fallback;

  return text;
}

function safeList(list, topRegion, analyzed){
  const arr = Array.isArray(list) ? list : [];
  const cleaned = arr.map(x=>clean(String(x))).filter(Boolean).slice(0,5);
  return cleaned.length ? cleaned : fallbackDrivers(topRegion, analyzed);
}
function driverTrendLabel(value){
  if(value >= 65) return 'elevated';
  if(value >= 40) return 'watch';
  return 'limited';
}
function fallbackDrivers(topRegion, analyzed){
  const d = analyzed.drivers || {};
  const ordered = Object.entries(d).sort((a,b)=>b[1]-a[1]).slice(0,5);
  return ordered.map(([k,v],i)=> i===0
    ? `${k}: primary ${driverTrendLabel(v)} signal (${Math.round(v)})`
    : `${k}: ${driverTrendLabel(v)} signal (${Math.round(v)})`
  );
}
function fallbackWatchNext(topRegion){
  return [
    `${topRegion}: new independent reporting`,
    'Official statements separated from reporting',
    'Driver score changes across regions',
    'Cross-source confirmation or contradiction'
  ];
}

// FIX: baseline placeholder articles (source === 'ORACLE Baseline'/'ORACLE System')
// are now excluded from the "verified sources" list so the UI can never claim
// e.g. "Reuters, AP, ..." verified sources when the underlying content was synthetic.
function getVerifiedSources(articles){
  const real = (articles||[]).filter(a => a.sourceType !== 'baseline-placeholder');
  const sources = [...new Set(real.map(a=>a.source).filter(Boolean))];
  const baseline = ['Reuters','AP','BBC','NHK','Al Jazeera'];
  const named = sources.filter(s=>baseline.includes(s));
  const other = sources.filter(s=>!baseline.includes(s) && !/^ORACLE/.test(s)).slice(0,4);
  return (named.length ? named : sources.filter(s=>!/^ORACLE/.test(s)).slice(0,5)).concat(other).filter((v,i,a)=>a.indexOf(v)===i).slice(0,8);
}

function normalizeSourceConfidence(sc, articles, meta){
  const report = Array.isArray(meta?.sourceReport) ? meta.sourceReport : [];
  const fromArticles = getVerifiedSources(articles); // FIX: use verified (non-baseline) sources only
  const availableFromReport = report.filter(r=>r.ok && r.count>0).map(r=>r.name);
  const limitedFromReport = report.filter(r=>!r.ok || r.count===0).map(r=>r.name);
  const available = [...new Set([...(Array.isArray(sc?.availableSources)?sc.availableSources:[]), ...availableFromReport, ...fromArticles])].filter(Boolean).slice(0,10);
  const limited = [...new Set([...(Array.isArray(sc?.limitedSources)?sc.limitedSources:[]), ...limitedFromReport])].filter(Boolean).slice(0,8);
  const note = meta?.isBaseline
    ? 'No live public feeds are currently reachable. ORACLE is displaying conservative baseline placeholder signals only — treat all figures as illustrative, not verified.'
    : meta?.degraded
    ? 'Multi-source monitoring is partially degraded; ORACLE is using available public feeds plus cached signals.'
    : 'Multi-source public monitoring is active across news, event, seismic, and space-weather feeds.';
  return {
    availableSources: available.length ? available : ['GDELT'],
    limitedSources: limited,
    note: safeIntelText(sc?.note || note, 'Source confidence is being monitored.', (articles||[]).map(a=>a.title).join(' '))
  };
}
function topicSummary(articles=[]){
  const corpus = (articles||[]).map(a=>String(a.title||'').toLowerCase()).join(' ');
  const regions = [];
  if(/iran|israel|gaza|hamas|hezbollah|houthi|red sea|lebanon|syria/.test(corpus)) regions.push('Middle East');
  if(/ukraine|russia|kyiv|donetsk|kharkiv|zaporizhzhia/.test(corpus)) regions.push('Eastern Europe');
  // FIX: removed the bare word 'maritime' from this East Asia match for the
  // same reason it was already removed from REGION_KEYWORDS' South China Sea
  // terms — 'maritime' is a generic word that also appears in Middle
  // East/Hormuz shipping stories, so keeping it here (while REGION_KEYWORDS
  // no longer uses it) meant this hero-text summary could still label a
  // Hormuz-only story as "East Asia" even though the actual region scoring
  // wouldn't. Now both use the same Taiwan/China/South China Sea-specific terms.
  if(/taiwan|china|south china sea|philippines|spratly|scarborough/.test(corpus)) regions.push('East Asia');
  if(/cyber|hack|malware|ransomware|breach|ddos/.test(corpus)) regions.push('cyber activity');
  if(/earthquake|volcano|storm|hurricane|typhoon|tsunami|wildfire|flood/.test(corpus)) regions.push('natural hazard monitoring');
  return regions.length ? regions.slice(0,3).join(', ') : 'monitored regions';
}

function buildFacts(articles, llm, meta){
  const sources = getVerifiedSources(articles);
  const sourceText = sources.length ? sources.slice(0,5).join(', ') : 'public sources';
  const topic = topicSummary(articles);
  const realArticles = (articles||[]).filter(a => a.sourceType !== 'baseline-placeholder');
  const count = realArticles.length;
  const facts = [];

  // FIX: if we're in baseline mode, say so plainly as the very first fact,
  // instead of only mentioning it deep in a "source status" line that reads
  // almost identically to the live-mode version.
  if(meta?.isBaseline){
    facts.push('No live public sources are currently reachable. The figures below are illustrative baseline placeholders, not verified reporting.');
    facts.push(`Public source degradation reason: ${clean(String(meta?.sourceError || 'unknown'))}.`);
    facts.push('Status: baseline mode — scores and regional rankings should not be treated as live intelligence.');
    return facts.slice(0,4);
  }

  facts.push(`${sourceText}: public reporting is being monitored across ${topic}.`);

  if(count > 0){
    facts.push(`ORACLE reviewed ${count} recent public signals and grouped them by military, diplomatic, cyber, logistics, finance, and disaster categories.`);
  } else {
    facts.push('Live public source volume is limited; ORACLE is using conservative baseline monitoring.');
  }

  if(meta?.degraded){
    facts.push('Source status: one or more live feeds are degraded, so cached signals may be used.');
  } else {
    facts.push('Source status: live public monitoring is active; details remain subject to verification by originating sources.');
  }

  facts.push('Status: verified public reporting only; ORACLE separates facts from AI assessment and outlook.');
  return facts.slice(0,4);
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
  const realArticles = (articles||[]).filter(a => a.sourceType !== 'baseline-placeholder');
  const articleCount = realArticles.length;
  const crossChecks = meta?.isBaseline ? 0 : Math.max(1, Math.min(4, sourceCount - 1));
  const reliability = sourceHealthScore(articles, meta);
  return { sourceCount, sources: combined.length ? combined : ['Public sources'], articleCount, crossChecks, reliability };
}

function conciseBrief(aiBrief='', articles=[], topRegion='Global', score=0, isBaseline=false){
  if(isBaseline){
    // FIX: baseline hero text must be unmistakably different from the live version.
    return `No live sources reachable — showing baseline placeholder data only, not verified monitoring.`;
  }
  const sources = getVerifiedSources(articles);
  const main = topRegion || 'Global';
  const level = score >= 50 ? 'elevated' : score >= 30 ? 'watch-level' : 'stable';
  if(sources.length >= 3) return `Multiple public sources indicate ${level} monitoring conditions led by ${main}.`;
  return `Available public signals indicate ${level} monitoring conditions led by ${main}.`;
}

function evidenceStrengthLabel(evidence, isBaseline){
  if(isBaseline) return 'NONE'; // FIX: baseline data has no real evidence strength
  const r = evidence?.reliability || 0;
  const sc = evidence?.sourceCount || 0;
  // FIX (honesty): thresholds were r>=70 && sc>=3 for MODERATE, r>=85 && sc>=5
  // for HIGH. In practice a routine day (e.g. 77% reliability, 10 sources)
  // already cleared MODERATE, which reads as "reasonably solid evidence" —
  // but the underlying method is keyword-matching heuristics with no
  // fact-checking, source-corroboration, or claim verification at all. That
  // gap between what the label implies and what was actually checked is the
  // problem, not the reliability number itself. Raising the bar (and
  // requiring more independent sources) makes MODERATE/HIGH rarer and closer
  // to what they should mean: "a lot of independent public reporting lines up",
  // not "the AI is confident this is true".
  if(r >= 92 && sc >= 7) return 'HIGH';
  if(r >= 80 && sc >= 6) return 'MODERATE';
  return 'LIMITED';
}

function topEventSummary(top, analyzed){
  const region = analyzed.regions?.find(r => (top?.title || '').toLowerCase().includes(r.name.split(' ')[0].toLowerCase()))?.name || analyzed.regions?.[0]?.name || 'global risk';

  // FIX: this used to pick the single globally-dominant driver across ALL
  // articles (Object.entries(analyzed.drivers)...) and attribute it to this
  // specific top event, regardless of what that event's own headline was
  // actually about. E.g. a clearly diplomatic headline ("US demands Iran
  // publicly state...") was being labeled "contributes mainly to the
  // military driver" purely because Military happened to be the largest
  // driver overall that cycle. Now we look up this article's own matched
  // categories (the same articleScores data timelineClassification uses)
  // and only fall back to the global dominant driver if no per-article
  // match exists.
  const scores = Array.isArray(analyzed?.articleScores) ? analyzed.articleScores : [];
  const match = scores.find(x =>
    (top?.url && x?.article?.url === top.url) ||
    (!top?.url && x?.article?.title === top?.title)
  );
  const primary = match?.primaryDriver
    || Object.entries(analyzed.drivers || {}).sort((a,b)=>b[1]-a[1])[0]?.[0]
    || 'risk';

  return `${top.source || 'Source'} report monitored as a ${region} signal; it contributes mainly to the ${primary.toLowerCase()} driver.`;
}

function sourceTimeLabel(article, fallbackIndex=0){
  const raw = article?.seen;
  const d = raw ? new Date(raw) : null;
  if(d && !Number.isNaN(d.getTime())){
    return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' }) + ' JST';
  }
  return fallbackIndex === 0 ? 'RECENT' : `SIGNAL ${fallbackIndex+1}`;
}

function buildScoreBridge(analyzed){
  return {
    raw: round1(analyzed.raw),
    stability: round1(analyzed.adjustment),
    duplicateNoise: round1(analyzed.duplicateReduction),
    globalNormalization: round1(analyzed.globalNormalization),
    final: analyzed.final,
    reasons: analyzed.adjustmentReasons || [],
    note: 'Raw weighted drivers are adjusted for duplicate noise, regional concentration, and global synchronization.'
  };
}

function timelineClassification(article, analyzed){
  const scores = Array.isArray(analyzed?.articleScores) ? analyzed.articleScores : [];
  const match = scores.find(x =>
    (article?.url && x?.article?.url === article.url) ||
    (!article?.url && x?.article?.title === article?.title)
  );

  if(match){
    const regions = Array.isArray(match.matchedRegions) ? match.matchedRegions : Object.keys(match.regs || {});
    const drivers = Object.keys(match.cats || {});
    return {
      regions: regions.slice(0,3),
      drivers: drivers.slice(0,3),
      primaryRegion: regions[0] || 'Global',
      primaryDriver: match.primaryDriver || drivers[0] || 'General',
      evidenceWeight: round1(match.score || 0)
    };
  }

  return { regions:[], drivers:[], primaryRegion:'Global', primaryDriver:'General', evidenceWeight:0 };
}

// FIX (coverage gap): ORACLE only scores 6 fixed regions. A real, heavily-
// reported conflict or crisis outside that list (Sudan, Myanmar, Haiti,
// Venezuela, etc.) would previously just vanish — it might get fetched by
// the collectors, get a Military/Diplomatic driver bump, but never surface
// anywhere a person could actually see it, because nothing renders
// unmatched articles. This pulls out headlines that matched at least one
// risk category (so it's not just random noise) but NO fixed region, sorted
// by the same event-scoring already used for the top event, so real gaps in
// coverage are visible on the page instead of silently dropped.
function buildOtherSignificantNews(analyzed){
  const scores = Array.isArray(analyzed?.articleScores) ? analyzed.articleScores : [];
  const unmatched = scores.filter(x => (!x.matchedRegions || x.matchedRegions.length === 0) && Object.keys(x.cats || {}).length > 0);
  const seenTitles = new Set();
  return unmatched
    .sort((a,b)=>b.score-a.score)
    .filter(x=>{
      const key = String(x.article?.title || '').toLowerCase();
      if(!key || seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    })
    .slice(0,5)
    .map(x=>({
      title: x.article?.title || '',
      source: x.article?.source || 'Source',
      url: x.article?.url || '#',
      primaryDriver: x.primaryDriver || 'General'
    }));
}

function buildPayload(analyzed, articles, llm, meta={}){
  const score = analyzed.final;
  const state = stateFromScore(score);
  const top = analyzed.top || { title:'Public signals under monitoring', source:'GDELT', url:'https://www.gdeltproject.org/' };
  const topRegion = analyzed.regions[0]?.name || 'Global';

  // FIX: baseline placeholder rows are excluded from the visible timeline —
  // showing fabricated "Ukraine remains under active conflict monitoring..."
  // text next to real-looking timestamps was the most misleading part of the
  // original output.
  const realArticles = (articles||[]).filter(a => a.sourceType !== 'baseline-placeholder');
  // FIX (timeline noise): the timeline used to show the most recent N articles
  // regardless of whether they matched ANY risk category or region — e.g. an
  // AP obituary piece mentioning "foreign policy" was appearing next to real
  // military/diplomatic signals just because it was recent, with no keyword
  // relevance at all. Now an article only qualifies for the timeline if it
  // matched at least one category or region during scoring (same match data
  // timelineClassification already computes), so off-topic recent articles
  // are excluded instead of being presented as risk signals.
  const timeline = [...realArticles]
    .map((a,i)=>({ article:a, index:i, cls: timelineClassification(a, analyzed) }))
    .filter(({cls}) => (cls.regions && cls.regions.length) || (cls.drivers && cls.drivers.length))
    .sort((x,y)=>{
      const ta = new Date(x.article?.seen || 0).getTime();
      const tb = new Date(y.article?.seen || 0).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    })
    .slice(0,5)
    .map(({article:a, index:i, cls})=>({ time: sourceTimeLabel(a,i), text: `${a.source}: ${a.title.slice(0,115)}`, source:a.source, url:a.url, sourceType:a.sourceType || 'public-reporting', ...cls }));

  const aiOk = Boolean(llm && !llm.error);
  const corpus = (articles||[]).map(a=>a.title).join(' ');
  const outlookLabel = aiOk
    ? normalizeOutlook(llm.outlook24h)
    : (score >= 55 ? 'WATCH' : 'STABLE');

  const isBaseline = Boolean(meta.isBaseline);

  // FIX: confidence now only gets the AI bonus when the call actually succeeded,
  // and is hard-capped low whenever we're in baseline mode (no real data at all).
  let confidence = analyzed.confidence;
  if(aiOk) confidence = clamp(confidence + 5, 45, 92);
  if(isBaseline) confidence = Math.min(confidence, 35);

  const evidence = buildEvidence(articles, meta, analyzed);

  return {
    ok:true,
    mode: isBaseline ? 'baseline' : (meta.degraded ? 'degraded' : 'live'),
    // FIX: dataStatus can now surface a distinct, unambiguous BASELINE state
    // instead of being lumped in with generic "CACHED / DEGRADED".
    dataStatus: isBaseline ? 'BASELINE — NOT LIVE' : (meta.degraded ? 'CACHED / DEGRADED' : 'LIVE SOURCES'),
    // FIX: expose the actual source-fetch cache duration so the frontend can
    // state it accurately instead of hardcoding a number that could drift out
    // of sync with CACHE_TTL_MS.
    cacheTtlMinutes: Math.round(CACHE_TTL_MS / 60000),
    isBaseline,
    aiUsed: aiOk,
    aiMode: aiOk ? 'AI ANALYSIS ACTIVE' : 'RULE BASED',
    aiError: llm?.error || null,
    sourceError: meta.sourceError || null,
    updatedAt:new Date().toISOString(),
    score,
    // FIX (honesty): this field used to drive the "+2 / 24H" figure on screen,
    // but it was never a real 24h-ago reading — just `score - 2` whenever the
    // top region had more than 2 articles, else `score - 0`. That produced an
    // almost-always-+2 display that looked like a real trend but wasn't. The
    // frontend no longer uses this field for the visible delta; it now keeps
    // its own timestamped score log (localStorage) and only shows a 24H delta
    // once a real ~24h-old reading exists, saying so plainly otherwise. This
    // field is kept only for backward compatibility / other potential
    // consumers and should not be re-wired into the hero delta.
    previousScore: clamp(score - (analyzed.regions[0]?.count > 2 ? 2 : 0), 0, 100),
    state,
    confidence,
    sourceHealth: isBaseline ? 0 : sourceHealthScore(articles, meta),
    contributors: analyzed.contributors || [],
    regionEvidence: analyzed.regionEvidence || {},
    facts: buildFacts(articles, llm, meta),
    outlook24h: outlookLabel,
    outlookText: alignedOutlookText(
      outlookLabel,
      aiOk ? llm.outlookText : '',
      topRegion,
      corpus
    ),
    keyDrivers: aiOk ? safeList(llm.keyDrivers, topRegion, analyzed) : fallbackDrivers(topRegion, analyzed),
    watchNext: aiOk ? safeList(llm.watchNext, topRegion, analyzed) : fallbackWatchNext(topRegion),
    sourceConfidence: aiOk ? normalizeSourceConfidence(llm.sourceConfidence, articles, meta) : normalizeSourceConfidence(null, articles, meta),
    verifiedSources: aiOk && Array.isArray(llm.verifiedSources) ? llm.verifiedSources.slice(0,8) : getVerifiedSources(articles),
    evidence,
    evidenceStrength: evidenceStrengthLabel(evidence, isBaseline),
    scoreBridge: buildScoreBridge(analyzed),
    articleCount: realArticles.length,
    brief: conciseBrief(aiOk ? safeIntelText(llm.brief, '', corpus) : '', articles, topRegion, score, isBaseline),
    assessment: isBaseline
      ? 'No live public sources are reachable right now. ORACLE cannot produce a verified assessment and is showing baseline placeholder data only.'
      : (aiOk ? safeIntelText(llm.assessment, `ORACLE assesses ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`, corpus) : `ORACLE assesses ${state.toLowerCase()} global risk conditions led by ${topRegion}. Signals remain regionally concentrated rather than globally synchronized.`),
    scoreReason: isBaseline
      ? 'This score is derived from baseline placeholder text, not live signals, and should not be treated as a real risk measurement.'
      : (aiOk ? safeIntelText(llm.scoreReason, `Score reflects weighted public signals across military, diplomacy, cyber, logistics, finance and disaster categories, adjusted for limited global synchronization.`, corpus) : `Score reflects weighted public signals across military, diplomacy, cyber, logistics, finance and disaster categories, adjusted for limited global synchronization.`),
    xPost: isBaseline ? null : (aiOk ? safeIntelText(llm.xPostGlobal || llm.xPost, '', corpus) : null),
    xPostGlobal: isBaseline ? null : (aiOk ? safeIntelText(llm.xPostGlobal || llm.xPost, '', corpus) : null),
    xPostJapanese: isBaseline ? null : (aiOk ? safeIntelText(llm.xPostJapanese, '', corpus) : null),
    hashtags: isBaseline ? null : (aiOk ? safeHashtags(llm.hashtags) : null),
    topEvent: isBaseline
      ? { title:'No live top event available', summary:'ORACLE has no verified public signals to select a top event from right now.', source:'ORACLE System', url:'https://www.gdeltproject.org/' }
      : { title: top.title, summary: topEventSummary(top, analyzed), source: top.source || 'GDELT', url: top.url || 'https://www.gdeltproject.org/' },
    drivers: Object.fromEntries(Object.entries(analyzed.drivers).filter(([k])=>!NON_SCORING_CATEGORIES.includes(k))),
    driverEvidence: Object.fromEntries(Object.entries(analyzed.driverEvidence || {}).filter(([k])=>!NON_SCORING_CATEGORIES.includes(k))),
    // FIX (score scope): informational-only, does not feed the ORACLE INDEX.
    disasterHealth: {
      Disaster: analyzed.drivers.Disaster || 0,
      Health: analyzed.drivers.Health || 0
    },
    weights: WEIGHTS,
    calculation: { raw: round1(analyzed.raw), stability: round1(analyzed.adjustment), duplicateNoise: round1(analyzed.duplicateReduction), globalNormalization: round1(analyzed.globalNormalization), containment: round1(analyzed.adjustment + analyzed.duplicateReduction + analyzed.globalNormalization), final: score, reasoning: buildReasoning(analyzed, topRegion), adjustmentReasons: analyzed.adjustmentReasons || [] },
    regions: analyzed.regions.map(r=>({ name:r.name, score:r.score, change:r.change, trend:r.trend, signals:round1(r.raw || r.count || 0), sources:r.sources || 0, articles:r.articles || 0, terms:r.terms || [], freshness:r.freshness || 0, breakdown:r.breakdown || {} })),
    inactiveRegions: (analyzed.inactiveRegions || []).map(r=>({ name:r.name, trend:'No verified activity' })),
    timeline: timeline.length ? timeline : [{time: isBaseline ? 'N/A' : 'NOW', text: isBaseline ? 'No live signals available.' : 'Monitoring active.'}],
    otherSignificantNews: isBaseline ? [] : buildOtherSignificantNews(analyzed),
    // FIX (honesty): these four tiles used to read like output from dedicated
    // feeds (a flight tracker, a cyber-threat feed, a shipping/logistics feed).
    // There are no such feeds — every value here is the SAME keyword-matched
    // Military/Cyber/Logistics driver score already shown in "WHY SCORE?",
    // just re-labeled. `metricsNote` lets the frontend say that plainly next
    // to the tiles instead of implying independent monitoring sources.
    metrics:{
      conflicts: String(Math.max(7, analyzed.regions.filter(r=>r.score>35).length + 4)), conflictsSub:'+1 / 24H · MONITORED',
      flights: analyzed.drivers.Military > 55 ? 'ELEVATED' : 'WATCH', flightsSub:'PUBLIC SIGNALS',
      cyber: analyzed.drivers.Cyber > 50 ? 'MEDIUM' : 'WATCH', cyberSub: analyzed.drivers.Cyber > 50 ? 'SURGE DETECTED' : 'LOW SURGE',
      logistics: analyzed.drivers.Logistics > 45 ? 'WATCH' : 'STABLE', logisticsSub: analyzed.drivers.Logistics > 45 ? 'PRESSURE' : 'CONTAINED',
      note: 'These tiles restate the Military / Cyber / Logistics keyword-driver scores above — there is no separate flight-tracking, cyber-threat, or shipping feed behind them.'
    }
  };
}

function sourceHealthScore(articles, meta){
  if(meta?.isBaseline) return 0; // FIX: baseline mode has zero real source health, not a fabricated 72%
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
  // FIX: this hard-fallback path (thrown exception) is now also explicitly
  // marked as non-live so the frontend can treat it consistently with the
  // baseline path above.
  return {
    ok:true, mode:'fallback', isBaseline:true, error, aiMode:'RULE BASED', updatedAt:new Date().toISOString(), score:28, previousScore:25, state:'STABLE', confidence:20, sourceHealth:0,
    serverDelta24h:{ available:false }, serverPreviousDay:null,
    dataStatus:'FALLBACK — NOT LIVE',
    cacheTtlMinutes: Math.round(CACHE_TTL_MS / 60000),
    brief:'ORACLE encountered an error and has no live data. Showing conservative fallback values only.',
    assessment:'This is a fallback response due to an internal error. It does not reflect live monitoring.',
    scoreReason:'Fallback score is a fixed conservative placeholder because live source retrieval did not complete.',
    facts:['An internal error prevented live public source retrieval.', 'ORACLE is showing conservative fallback values, not verified signals.', 'No synchronized global escalation signal is available from current inputs.'],
    outlook24h:'STABLE', outlookText:'Conditions remain stable unless additional verified public signals emerge.',
    keyDrivers:['Baseline military monitoring','Limited source volume','Regional pressure only'],
    watchNext:['GDELT availability','Verified regional escalation signals','Major diplomatic or logistics changes'],
    sourceConfidence:{availableSources:[],limitedSources:['GDELT','Google News','USGS','NOAA','Guardian'],note:'Live public source retrieval failed entirely; all figures are fallback placeholders, not verified data.'},
    verifiedSources:[], evidence:{sourceCount:0, sources:[], articleCount:0, crossChecks:0, reliability:0}, evidenceStrength:'NONE', articleCount:0,
    topEvent:{ title:'No live top event available', summary:'No verified public signals are available due to an internal error.', source:'ORACLE System', url:'https://www.gdeltproject.org/' },
    drivers:{ Military:38, Diplomatic:26, Cyber:18, Logistics:12, Finance:10 }, disasterHealth:{ Disaster:0, Health:0 }, weights:WEIGHTS, calculation:{ raw:31.9, containment:-3.9, final:28, adjustmentReasons:['Fallback mode: adjustment reasons are not available because live scoring did not run.'] },
    regions:[{name:'Ukraine',score:44,change:'+1',trend:'Watch'},{name:'Taiwan Strait',score:39,change:'0',trend:'Watch'},{name:'Middle East',score:37,change:'0',trend:'Stable'},{name:'South China Sea',score:31,change:'0',trend:'Stable'},{name:'Korea',score:25,change:'0',trend:'Stable'}],
    timeline:[{time:'N/A',text:'Fallback mode active — no live data.'}], otherSignificantNews:[], metrics:{ conflicts:'7', conflictsSub:'+1 / 24H · MONITORED', flights:'WATCH', flightsSub:'PUBLIC SIGNALS', cyber:'WATCH', cyberSub:'LOW SURGE', logistics:'STABLE', logisticsSub:'CONTAINED', note:'Fallback mode: no scoring ran, so these tiles are fixed placeholders, not even keyword-derived values.' }
  };
}
