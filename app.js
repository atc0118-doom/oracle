const $ = (id) => document.getElementById(id);
let currentData = null;
let lastLoadedAt = Date.now();

const fallback = {
  ok: true,
  mode: 'rule-based fallback',
  score: 28,
  previousScore: 25,
  state: 'WATCH',
  confidence: 74,
  evidenceStrength: 'LIMITED',
  updatedAt: new Date().toISOString(),
  sourceHealth: 88,
  aiMode: 'RULE BASED',
  brief: 'Regional tensions remain elevated. Global escalation risk remains contained.',
  assessment: 'AI-assisted rules detected elevated regional pressure without synchronized global escalation.',
  facts: ['Public monitoring signals are active.', 'Regional pressure remains localized.', 'No synchronized global escalation signal is currently detected.'],
  outlook24h: 'STABLE',
  outlookText: 'Conditions are expected to remain watchful unless additional verified signals emerge.',
  keyDrivers: ['Regional military pressure','Diplomatic friction','Contained logistics signal'],
  watchNext: ['Verified escalation signals','Major diplomatic statements','Cyber or logistics spillover'],
  sourceConfidence: { availableSources:['GDELT'], limitedSources:[], note:'Public sources are monitored for situational awareness.' },
  verifiedSources: ['GDELT'],
  topEvent: { title: 'Global signals under monitoring', summary: 'Public signals are monitored as source-bound risk inputs.', source: 'GDELT', url: 'https://www.gdeltproject.org/' },
  contributors: [{name:'Ukraine', share:38, impact:12, score:56, trend:'Watch'}, {name:'Middle East', share:31, impact:9, score:45, trend:'Watch'}, {name:'Taiwan Strait', share:18, impact:5, score:49, trend:'Watch'}],
  scoreBridge: { raw:32.6, stability:-2, duplicateNoise:0, globalNormalization:-2.6, final:28, note:'Raw weighted drivers are adjusted for duplicate noise, regional concentration, and global synchronization.' },
  drivers: { Military: 42, Diplomatic: 32, Cyber: 18, Logistics: 12, Finance: 9, Disaster: 6 },
  calculation: { raw: 32.6, containment: -4.6, final: 28, lines: [] },
  regions: [
    { name: 'Ukraine', score: 56, change: '+2', trend: 'Rising' },
    { name: 'Taiwan Strait', score: 49, change: '+1', trend: 'Watch' },
    { name: 'Middle East', score: 45, change: '0', trend: 'Stable' },
    { name: 'South China Sea', score: 38, change: '+1', trend: 'Watch' },
    { name: 'Korea', score: 31, change: '0', trend: 'Stable' }
  ],
  timeline: [
    { time: 'NOW', text: 'Public event monitoring active.' },
    { time: '-15M', text: 'AI-assisted classification completed.' },
    { time: '-60M', text: 'Risk drivers recalculated.' }
  ],
  metrics: { conflicts: '7', conflictsSub: 'MONITORED', flights: 'WATCH', flightsSub: 'PUBLIC SIGNALS', cyber: 'WATCH', cyberSub: 'LOW SURGE', logistics: 'STABLE', logisticsSub: 'CONTAINED' }
};

function clamp(n,min,max){ return Math.max(min, Math.min(max, Number(n)||0)); }
function fmtTime(iso){
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone:'Asia/Tokyo' }) + ' JST';
}
function stateFromScore(score){
  if(score >= 70) return 'CRITICAL';
  if(score >= 50) return 'HIGH';
  if(score >= 30) return 'WATCH';
  return 'STABLE';
}
// ---------------------------------------------------------------------------
// Daily-return features: visit streak, score history, and a "what changed
// since last time you looked" summary. All client-side (localStorage), no
// backend change needed — this is purely about making a repeat visit feel
// worthwhile, not about the accuracy of the score itself.
// ---------------------------------------------------------------------------
const HISTORY_KEY = 'oracle_score_history_v1';
const STREAK_KEY = 'oracle_streak_v1';
const MAX_HISTORY_DAYS = 30;

function todayStamp(){
  // Use JST calendar day so the streak lines up with the JST timestamps shown elsewhere.
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US', { timeZone:'Asia/Tokyo' }));
  return `${jst.getFullYear()}-${String(jst.getMonth()+1).padStart(2,'0')}-${String(jst.getDate()).padStart(2,'0')}`;
}
function daysBetweenStamps(a, b){
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function loadHistory(){
  try{ return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); }catch(_){ return []; }
}
function saveHistory(history){
  try{ localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY_DAYS))); }catch(_){ /* storage unavailable, skip silently */ }
}

function updateStreak(stamp){
  let streak;
  try{ streak = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null'); }catch(_){ streak = null; }
  if(!streak){
    streak = { lastDate: stamp, count: 1 };
  }else if(streak.lastDate === stamp){
    // already counted today
  }else{
    const gap = daysBetweenStamps(streak.lastDate, stamp);
    streak = gap === 1 ? { lastDate: stamp, count: streak.count + 1 } : { lastDate: stamp, count: 1 };
  }
  try{ localStorage.setItem(STREAK_KEY, JSON.stringify(streak)); }catch(_){ /* ignore */ }
  return streak.count;
}

function recordVisitAndDiff(data){
  const stamp = todayStamp();
  const score = clamp(data.score, 0, 100);
  const state = data.state || stateFromScore(score);
  const topRegion = (data.regions && data.regions[0] && data.regions[0].name) || 'Global';
  const watchNext = Array.isArray(data.watchNext) ? data.watchNext.slice(0,5) : [];

  const history = loadHistory();
  const last = history[history.length - 1];

  // One entry per calendar day: update today's entry in place on repeat loads,
  // otherwise append a fresh day so the sparkline reflects one point per day.
  if(last && last.date === stamp){
    last.score = score; last.state = state; last.topRegion = topRegion; last.watchNext = watchNext;
  }else{
    history.push({ date: stamp, score, state, topRegion, watchNext });
  }
  const previousEntry = (last && last.date === stamp) ? history[history.length - 2] : last;
  saveHistory(history);

  const streakCount = updateStreak(stamp);
  const streakLabel = $('streakLabel');
  if(streakLabel) streakLabel.textContent = `${streakCount} DAY${streakCount === 1 ? '' : 'S'} STREAK`;

  // FIX (persistence): use the server's previous-day snapshot (Redis-backed,
  // same on every device) for the diff text and follow-up list when the
  // backend has one; only fall back to this browser's own localStorage entry
  // if server-side storage isn't configured yet.
  const referenceEntry = data.serverPreviousDay || previousEntry;

  const diffEl = $('dailyDiffText');
  if(diffEl){
    if(!referenceEntry){
      diffEl.textContent = `First visit logged today. Come back tomorrow to see how the index moved.`;
    }else{
      const delta = score - referenceEntry.score;
      const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'unchanged';
      const deltaText = delta === 0 ? 'unchanged' : `${dir} ${Math.abs(delta)} pts`;
      const regionNote = referenceEntry.topRegion && referenceEntry.topRegion !== topRegion
        ? ` Top region shifted from ${referenceEntry.topRegion} to ${topRegion}.`
        : '';
      const stateNote = referenceEntry.state && referenceEntry.state !== state
        ? ` Status moved from ${referenceEntry.state} to ${state}.`
        : '';
      diffEl.textContent = `Since your last visit (${referenceEntry.date}): index ${deltaText} (${referenceEntry.score} → ${score}).${stateNote}${regionNote}`;
    }
  }

  renderSparkline(history);
  renderWatchFollowup(referenceEntry, data);
}

// Very deliberately simple: this is a keyword-overlap check, not a real
// fact-check. It looks at whether words from yesterday's watch-next item
// still show up anywhere in today's regions/drivers/timeline/facts text.
// That can produce false positives (generic overlap) and false negatives
// (same topic, different wording) — it's meant as a rough "did this stay
// on the radar" signal, not a scored prediction record.
function todaysSignalText(data){
  const parts = [
    ...(data.regions || []).map(r=>r.name),
    ...Object.keys(data.drivers || {}),
    ...(data.timeline || []).map(t=>t.text),
    ...(data.facts || []),
    data.assessment || '',
    data.outlookText || ''
  ];
  return parts.join(' ').toLowerCase();
}
function extractKeywords(phrase=''){
  const stop = new Set(['the','and','for','with','from','into','about','over','under','new','more','any','not','are','was','were','has','have','this','that','signals','signal','changes','change','reporting','statements','statement','only']);
  return String(phrase).toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>3 && !stop.has(w));
}
function renderWatchFollowup(previousEntry, currentData){
  const el = $('watchFollowup');
  if(!el) return;
  const items = previousEntry?.watchNext || [];
  if(!previousEntry || !items.length){
    el.innerHTML = '<li>No watch-next items recorded yet — check back tomorrow.</li>';
    return;
  }
  const todayText = todaysSignalText(currentData);
  el.innerHTML = items.map(item=>{
    const keywords = extractKeywords(item);
    const hit = keywords.length && keywords.some(k=>todayText.includes(k));
    const badge = hit
      ? '<span class="followup-badge followup-hit">STILL ON RADAR</span>'
      : '<span class="followup-badge followup-miss">NOT MENTIONED TODAY</span>';
    return `<li>${escapeHtml(item)} ${badge}</li>`;
  }).join('') + `<li class="followup-date">From ${previousEntry.date}'s watch list</li>`;
}

function renderSparkline(history){
  const svg = $('sparkline');
  if(!svg) return;
  const points = history.slice(-MAX_HISTORY_DAYS);
  if(points.length < 2){
    svg.innerHTML = '';
    if($('sparklineFrom')) $('sparklineFrom').textContent = points[0]?.date || '—';
    return;
  }
  const w = 300, h = 60, pad = 4;
  const scores = points.map(p=>p.score);
  const min = Math.min(...scores), max = Math.max(...scores);
  const range = Math.max(1, max - min);
  const stepX = (w - pad*2) / (points.length - 1);
  const coords = points.map((p,i)=>{
    const x = pad + i*stepX;
    const y = h - pad - ((p.score - min) / range) * (h - pad*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = coords[coords.length-1].split(',');
  svg.innerHTML = `
    <polyline points="${coords.join(' ')}" fill="none" stroke="#c9ab45" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="#c9ab45"/>
  `;
  if($('sparklineFrom')) $('sparklineFrom').textContent = `${points[0].date} · ${points[0].score}`;
}

const SCORE_LOG_KEY = 'oracle_score_log_v1';
const SCORE_LOG_MAX_AGE_MS = 8 * 24 * 60 * 60 * 1000; // keep 8 days of raw points
const SCORE_LOG_MAX_ENTRIES = 1000;

function loadScoreLog(){
  try{ return JSON.parse(localStorage.getItem(SCORE_LOG_KEY) || '[]'); }catch(_){ return []; }
}
function saveScoreLog(log){
  try{ localStorage.setItem(SCORE_LOG_KEY, JSON.stringify(log.slice(-SCORE_LOG_MAX_ENTRIES))); }catch(_){ /* storage unavailable, skip silently */ }
}
function recordScoreLog(score){
  const now = Date.now();
  const log = loadScoreLog().filter(e => now - e.ts <= SCORE_LOG_MAX_AGE_MS);
  log.push({ ts: now, score });
  saveScoreLog(log);
  return log;
}

// FIX (honesty): the "+2 / 24H" figure used to come from the backend's
// `previousScore`, which was computed as `score - (topRegion.count > 2 ? 2 : 0)`
// — not an actual reading from 24 hours ago, just a fixed +2/+0 depending on
// one region's article count. It looked like a real trend indicator but
// wasn't. Now that visits are logged client-side with real timestamps, we
// look for an actual reading from ~24h ago and only show a delta when one
// genuinely exists. If the log doesn't go back that far yet (e.g. this is a
// new browser/first day), we say so instead of showing a fabricated number.
function getRealDelta24h(log, currentScore){
  if(!log.length) return { available:false };
  const targetTs = Date.now() - 24*60*60*1000;
  // Accept anything from 20h to 30h ago as "close enough to 24h" — polling
  // isn't perfectly regular, so an exact 24h-old sample won't usually exist.
  const windowMin = Date.now() - 30*60*60*1000;
  const windowMax = Date.now() - 20*60*60*1000;
  const candidates = log.filter(e => e.ts >= windowMin && e.ts <= windowMax);
  if(!candidates.length) return { available:false };
  const closest = candidates.reduce((best,e)=>
    Math.abs(e.ts - targetTs) < Math.abs(best.ts - targetTs) ? e : best
  );
  return { available:true, delta: Math.round(currentScore - closest.score), refScore: closest.score, refTs: closest.ts };
}

// ---------------------------------------------------------------------------
// Share card: renders a square PNG (score, state, mini sparkline, top region,
// timestamp) so a post on X has an image instead of bare text — image posts
// get meaningfully more reach on X than text-only ones. Built entirely
// client-side on a hidden <canvas>; no server round-trip needed.
// ---------------------------------------------------------------------------
const STATE_COLORS = { STABLE:'#47b881', WATCH:'#c9ab45', HIGH:'#e08a3c', CRITICAL:'#e5484d' };

function drawShareCard(){
  const canvas = $('shareCanvas');
  if(!canvas) return null;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const score = clamp(currentData?.score ?? 0, 0, 100);
  const state = currentData?.state || stateFromScore(score);
  const stateColor = STATE_COLORS[state] || '#c9ab45';
  const topRegion = (currentData?.regions && currentData.regions[0]?.name) || 'Global';
  const history = loadHistory().slice(-14);

  // Background
  const bg = ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,'#0b0e12'); bg.addColorStop(1,'#05070a');
  ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
  ctx.fillStyle = 'rgba(255,255,255,.03)';
  ctx.beginPath(); ctx.arc(W/2, H*0.34, 380, 0, Math.PI*2); ctx.fill();

  // Brand
  ctx.textAlign = 'left';
  ctx.fillStyle = '#f3f5f7';
  ctx.font = '700 40px Arial';
  ctx.fillText('O R A C L E', 60, 100);
  ctx.fillStyle = '#828b96';
  ctx.font = '600 20px Arial';
  ctx.fillText('WORLD RISK INTELLIGENCE', 62, 130);

  // Live pill
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  roundRect(ctx, W-190, 62, 130, 42, 21); ctx.fill();
  ctx.fillStyle = '#47b881';
  ctx.beginPath(); ctx.arc(W-160, 83, 6, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#cfd5db'; ctx.font = '600 16px Arial'; ctx.textAlign='left';
  ctx.fillText('LIVE', W-140, 89);

  // ORACLE INDEX label
  ctx.textAlign = 'center';
  ctx.fillStyle = '#828b96'; ctx.font = '600 26px Arial';
  ctx.fillText('O R A C L E   I N D E X', W/2, 240);

  // Big score
  ctx.fillStyle = '#f4f6f8';
  ctx.font = '800 320px Arial';
  ctx.fillText(String(score), W/2, 560);

  // State
  ctx.fillStyle = stateColor;
  ctx.font = '700 56px Arial';
  ctx.fillText(state, W/2, 650);

  // Top region line
  ctx.fillStyle = '#c8cdd3'; ctx.font = '400 30px Arial';
  ctx.fillText(`Led by ${topRegion}`, W/2, 710);

  // Sparkline (last up to 14 days)
  if(history.length >= 2){
    const padX = 140, top = 760, chartH = 130, chartW = W - padX*2;
    const scores = history.map(p=>p.score);
    const min = Math.min(...scores), max = Math.max(...scores);
    const range = Math.max(1, max-min);
    ctx.beginPath();
    history.forEach((p,i)=>{
      const x = padX + (i/(history.length-1))*chartW;
      const y = top + chartH - ((p.score-min)/range)*chartH;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.strokeStyle = stateColor; ctx.lineWidth = 5; ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.stroke();
    const lastX = padX + chartW, lastY = top + chartH - ((history[history.length-1].score-min)/range)*chartH;
    ctx.beginPath(); ctx.arc(lastX,lastY,8,0,Math.PI*2); ctx.fillStyle = stateColor; ctx.fill();
    ctx.fillStyle = '#828b96'; ctx.font='400 20px Arial'; ctx.textAlign='left';
    ctx.fillText(`${history[0].date}`, padX, top+chartH+34);
    ctx.textAlign='right';
    ctx.fillText('TODAY', padX+chartW, top+chartH+34);
  }

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6b7480'; ctx.font = '400 22px Arial';
  ctx.fillText(`Updated ${fmtTime(currentData?.updatedAt)} · ${window.location.hostname}`, W/2, H-90);
  ctx.fillStyle = '#565f6a'; ctx.font = '400 18px Arial';
  ctx.fillText('Experimental project — keyword-based heuristics, not a validated risk model.', W/2, H-56);

  return canvas;
}

function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

async function handleShareCard(){
  const btn = $('shareCardBtn');
  if(btn) { btn.disabled = true; btn.textContent = 'GENERATING…'; }
  try{
    const canvas = drawShareCard();
    if(!canvas) return;
    canvas.toBlob((blob)=>{
      if(!blob){ if(btn){ btn.disabled=false; btn.textContent='📷 SHARE CARD FOR X'; } return; }
      // FIX: navigator.share({files:[...]}) was used here before, but on
      // several Android/X-in-app-browser combinations it reports
      // navigator.canShare({files}) === true yet the actual share sheet only
      // passes the `text` through to X and silently drops the image —
      // producing exactly the "posted, but no picture" result. Rather than
      // depend on that inconsistent behavior, we always force a direct PNG
      // download here; the user attaches it manually in the X compose
      // screen, which works the same way on every device.
      const file = new File([blob], `oracle-index-${todayStamp()}.png`, { type:'image/png' });
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
      if(btn){ btn.disabled=false; btn.textContent='✅ SAVED — ATTACH IN X'; setTimeout(()=>{ btn.textContent='📷 SHARE CARD FOR X'; }, 2500); }
    }, 'image/png');
  }catch(e){
    if(btn){ btn.disabled=false; btn.textContent='📷 SHARE CARD FOR X'; }
  }
}

// ---------------------------------------------------------------------------
// GLOBAL RISK MAP: colors actual countries by the score of the ORACLE region
// they belong to. Deliberately narrow mapping — e.g. "Ukraine" colors only
// Ukraine, not Russia; "Taiwan Strait" colors only Taiwan, not mainland
// China — so a huge, mostly-uninvolved landmass doesn't visually dominate
// the map and imply a scale of risk the data doesn't support. "Global Cyber"
// has no fixed geography, so it's intentionally left off the map.
// ---------------------------------------------------------------------------
const REGION_COUNTRY_IDS = {
  'Ukraine': ['804'],
  'Taiwan Strait': ['158'],
  'Middle East': ['376','422','275','760','364','887'], // Israel, Lebanon, Palestine, Syria, Iran, Yemen
  'South China Sea': ['608','704','458','096'], // Philippines, Vietnam, Malaysia, Brunei
  'Korea': ['408','410'] // North Korea, South Korea
};

let worldAtlasCache = null;
async function loadWorldAtlas(){
  if(worldAtlasCache) return worldAtlasCache;
  const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
  worldAtlasCache = await res.json();
  return worldAtlasCache;
}

function mapColorForScore(score){
  const state = stateFromScore(score);
  return STATE_COLORS[state] || '#c9ab45';
}

async function renderWorldMap(data){
  const container = $('mapContainer');
  if(!container || typeof d3 === 'undefined' || typeof topojson === 'undefined') return;

  let world;
  try{
    world = await loadWorldAtlas();
  }catch(_){
    container.innerHTML = '<div class="map-loading">Map data unavailable right now.</div>';
    return;
  }

  const regionByName = {};
  (data.regions || []).forEach(r => { regionByName[r.name] = r; });

  // Build id -> {score, regionName} for every country tied to a matched region.
  const idToRegion = {};
  Object.entries(REGION_COUNTRY_IDS).forEach(([regionName, ids])=>{
    const region = regionByName[regionName];
    if(!region) return; // region had no verified signal this cycle — leave its countries uncolored
    ids.forEach(id => { idToRegion[id] = region; });
  });

  const width = container.clientWidth || 600;
  const height = Math.round(width * 0.52);

  const countries = topojson.feature(world, world.objects.countries).features;
  const projection = d3.geoNaturalEarth1().fitSize([width, height], { type:'Sphere' });
  const path = d3.geoPath(projection);

  container.innerHTML = '';
  const svg = d3.select(container).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('height', 'auto')
    .attr('role', 'img')
    .attr('aria-label', 'World map with monitored risk regions highlighted');

  svg.append('path')
    .attr('d', path({ type:'Sphere' }))
    .attr('fill', '#0c1015');

  svg.selectAll('path.country')
    .data(countries)
    .join('path')
    .attr('class', 'country')
    .attr('d', path)
    .attr('fill', d => {
      const matched = idToRegion[String(d.id)];
      return matched ? mapColorForScore(matched.score) : '#181e25';
    })
    .attr('stroke', '#05070a')
    .attr('stroke-width', 0.4)
    .append('title')
    .text(d => {
      const matched = idToRegion[String(d.id)];
      return matched
        ? `${d.properties.name} — ${matched.name}: ${matched.score} (${stateFromScore(matched.score)})`
        : d.properties.name;
    });

  renderMapLegend();
}

function renderMapLegend(){
  const el = $('mapLegend');
  if(!el) return;
  const stops = [['STABLE', STATE_COLORS.STABLE], ['WATCH', STATE_COLORS.WATCH], ['HIGH', STATE_COLORS.HIGH], ['CRITICAL', STATE_COLORS.CRITICAL]];
  el.innerHTML = stops.map(([label, color]) => `<span class="map-legend-item"><i style="background:${color}"></i>${label}</span>`).join('')
    + `<span class="map-legend-item map-legend-none"><i></i>NOT MONITORED</span>`;
}

function render(data){
  currentData = data || fallback;
  const score = clamp(currentData.score, 0, 100);
  const state = currentData.state || stateFromScore(score);
  $('score').textContent = score;
  $('state').textContent = state;

  const scoreLog = recordScoreLog(score);
  // FIX (persistence): prefer the server-side delta (Redis-backed, works
  // across devices/browsers) when the backend has one; only fall back to the
  // client-only localStorage version if no storage is configured server-side
  // or it doesn't have a ~24h-old point yet either.
  let deltaText = null;
  if(currentData.serverDelta24h?.available){
    const diff = Math.round(score - currentData.serverDelta24h.refScore);
    deltaText = `${diff >= 0 ? '▲ +' : '▼ '}${Math.abs(diff)} / 24H`;
  }else{
    const real24h = getRealDelta24h(scoreLog, score);
    if(real24h.available){
      const diff = real24h.delta;
      deltaText = `${diff >= 0 ? '▲ +' : '▼ '}${Math.abs(diff)} / 24H`;
    }
  }
  $('delta').textContent = deltaText || 'COLLECTING 24H HISTORY —';

  $('updated').textContent = `UPDATED — ${fmtTime(currentData.updatedAt)}`;
  $('lastSync').textContent = fmtTime(currentData.updatedAt);
  $('brief').textContent = shortIntelText(currentData.brief || fallback.brief, 165);
  $('assessment').textContent = currentData.assessment || fallback.assessment;
  renderFacts(currentData.facts || fallback.facts);
  renderOutlook(currentData);
  renderLists('keyDrivers', currentData.keyDrivers || fallback.keyDrivers);
  renderLists('watchNext', currentData.watchNext || fallback.watchNext);
  renderSourceConfidence(currentData.sourceConfidence || fallback.sourceConfidence);
  renderEvidence(currentData);
  renderDataSources(currentData);
  $('confidence').textContent = `EVIDENCE STRENGTH ${currentData.evidenceStrength || evidenceStrengthFromData(currentData)}`;
  $('confidenceBar').style.width = `${clamp(currentData.sourceHealth || currentData.confidence || 70,0,100)}%`;
  renderContributors(currentData.contributors || fallback.contributors || []);
  renderScoreBridge(currentData.scoreBridge || fallback.scoreBridge || {});
  $('aiMode').textContent = currentData.aiMode || (currentData.aiUsed ? 'LLM ASSISTED' : 'RULE BASED');
  const statusText = currentData.dataStatus || (currentData.mode === 'live' ? 'LIVE SOURCES' : currentData.mode === 'degraded' ? 'CACHED / DEGRADED' : 'BASELINE');
  if($('dataStatus')) $('dataStatus').textContent = statusText;
  $('sourceHealth').textContent = `${Math.round(currentData.sourceHealth || 90)}%`;
  // FIX (honesty): the headline used to hardcode "60 SEC" (the browser's own
  // auto-refresh timer) right above a footnote admitting the real server
  // cache is 10 minutes — two numbers on screen at once describing the same
  // thing differently. The real cache duration is now the headline value.
  if($('pollInterval') || $('cacheNote')){
    const ttl = currentData.cacheTtlMinutes;
    const ttlLabel = ttl ? `${ttl} MIN` : '10 MIN';
    if($('pollInterval')) $('pollInterval').textContent = ttlLabel;
    if($('cacheNote')) $('cacheNote').textContent = ttl
      ? `Source data is cached up to ${ttl} min server-side`
      : 'Source cache duration unknown';
  }

  const e = currentData.topEvent || fallback.topEvent;
  $('eventSource').textContent = e.source || 'SOURCE';
  $('eventTitle').textContent = e.title || 'Monitoring public signals';
  $('eventSummary').textContent = e.summary || '';
  $('eventLink').href = e.url || '#';

  renderDrivers(currentData.drivers || fallback.drivers);
  renderRegions(currentData.regions || fallback.regions);
  renderTimeline(currentData.timeline || fallback.timeline);
  renderMetrics(currentData.metrics || fallback.metrics);
  renderCalc(currentData);
  recordVisitAndDiff(currentData);
  renderWorldMap(currentData);
  if($('debugBox')) $('debugBox').textContent = JSON.stringify(currentData, null, 2);
  lastLoadedAt = Date.now();
}
function renderFacts(facts){
  const box = $('facts');
  if(!box) return;
  const list = Array.isArray(facts) ? facts.slice(0,4) : [];
  box.innerHTML = list.map(f=>`<div class="fact-row"><span>FACT</span><p>${escapeHtml(f)}</p></div>`).join('') || '<p>Public signals are being monitored.</p>';
}
function renderOutlook(d){
  const o = $('outlookValue');
  const t = $('outlookText');
  if(o) o.textContent = d.outlook24h || 'STABLE';
  if(t) t.textContent = d.outlookText || fallback.outlookText;
}
function renderLists(id, items){
  const el = $(id);
  if(!el) return;
  const list = Array.isArray(items) ? items.slice(0,5) : [];
  el.innerHTML = list.map(x=>`<li>${escapeHtml(x)}</li>`).join('') || '<li>Monitoring public signals.</li>';
}
function uniqueSourceNames(items=[]){
  const seen = new Set();
  return items.filter(Boolean).filter(name=>{
    const key = String(name).trim().toLowerCase();
    if(!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderSourceConfidence(sc){
  const el = $('sourceConfidence');
  if(!el) return;
  const limited = uniqueSourceNames(sc.limitedSources || []).slice(0,5);
  const limitedHtml = limited.length
    ? `<div class="source-pillset">${limited.map(s=>`<em>LIMITED · ${escapeHtml(s)}</em>`).join('')}</div>`
    : '';
  el.innerHTML = `${limitedHtml}<p>${escapeHtml(sc.note || 'Source status is being monitored.')}</p>`;
}

function renderEvidence(data){
  const ev = data.evidence || {};
  const sources = uniqueSourceNames([
    ...(Array.isArray(ev.sources) ? ev.sources : []),
    ...(data.verifiedSources || []),
    ...((data.sourceConfidence && data.sourceConfidence.availableSources) || [])
  ]);
  // FIX: the "N SOURCES" label used to come from the backend's own count
  // (ev.sourceCount, capped at 10) while the badge list below it was a
  // separately-deduplicated client-side array capped at 8 — two different
  // numbers computed two different ways, so they could (and did) disagree,
  // e.g. "9 SOURCES" label with only 8 badges actually shown. Now both the
  // label and the badges are derived from the same displayed list, so they
  // can never mismatch.
  const displayedSources = sources.slice(0, 10);
  const sourceCount = displayedSources.length || 1;
  const articleCount = ev.articleCount || data.articleCount || 0;
  const reliability = Math.round(ev.reliability || data.sourceHealth || 70);
  const checks = ev.crossChecks || Math.max(1, Math.min(3, sourceCount - 1));
  if($('evidenceSources')) $('evidenceSources').textContent = `${sourceCount} SOURCES`;
  if($('evidenceChecks')) $('evidenceChecks').textContent = `${checks} CROSS CHECKS`;
  if($('evidenceArticles')) $('evidenceArticles').textContent = `${articleCount} SIGNALS`;
  if($('evidenceReliability')) $('evidenceReliability').textContent = `${reliability}%`;
  if($('evidenceSourceList')) $('evidenceSourceList').innerHTML = (displayedSources.map(s=>`<b>✓ ${escapeHtml(s)}</b>`).join('') || '<em>Public sources monitored</em>') + `<small class="evidence-definition">Reliability estimate reflects active feed coverage, source diversity, signal volume, and feed health. Cross checks indicate independent source groups, not fact-check verdicts.</small>`;
}

function renderDataSources(data){
  const el = $('dataSourcesList');
  if(!el) return;

  // FIX: this panel used to be static HTML listing GDELT/Reuters/AP/BBC/NHK/
  // USGS/NASA/MarineTraffic/FlightRadar24 as permanently "active" (green dot),
  // even though the backend never calls NASA, MarineTraffic, or FlightRadar24
  // at all, and Reuters/AP/BBC/NHK only ever appear as the *origin* of an
  // aggregated article (via GDELT/Google News), not as separately-fetched
  // feeds. That mismatch is exactly what made this panel contradict the
  // "SOURCE CONFIDENCE" section, which correctly showed some of those same
  // names as "LIMITED". Now this panel is built only from what the current
  // payload actually reports.
  const available = uniqueSourceNames((data.sourceConfidence && data.sourceConfidence.availableSources) || []);
  const limited = uniqueSourceNames((data.sourceConfidence && data.sourceConfidence.limitedSources) || []);
  const evidenceSources = uniqueSourceNames((data.evidence && data.evidence.sources) || []);
  const verified = uniqueSourceNames(data.verifiedSources || []);

  const seen = new Set();
  const badges = [];

  const addBadge = (name, status)=>{
    const key = name.toLowerCase();
    if(seen.has(key)) return;
    seen.add(key);
    badges.push({ name, status });
  };

  // FIX: previously "active" sources were added first and "limited" sources
  // last, then the whole list was capped with .slice(0,12). Whenever the
  // active count happened to land at exactly the cap (as it did here), the
  // limited/non-working sources — the most important thing to surface —
  // were silently cut off, even though the SOURCE CONFIDENCE panel elsewhere
  // on the same page correctly listed them as LIMITED. Limited sources are
  // now added first so they can never be pushed out by the cap, and the cap
  // itself is raised to give more headroom.
  limited.forEach(s=>addBadge(s,'limited'));
  available.forEach(s=>addBadge(s,'active'));
  evidenceSources.forEach(s=>addBadge(s,'active'));
  verified.forEach(s=>addBadge(s,'active'));

  if(!badges.length){
    el.innerHTML = '<em>No source status reported.</em>';
    return;
  }

  el.innerHTML = badges.slice(0,16).map(b=>
    `<b data-status="${b.status}">${escapeHtml(b.name)} <i></i></b>`
  ).join('');
}

function escapeHtml(str=''){
  return String(str).replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function escapeAttr(str=''){
  return escapeHtml(str).replace(/'/g,'&#39;');
}

function ensureRegionEvidenceModal(){
  let modal = $('regionEvidenceModal');
  if(modal) return modal;
  modal = document.createElement('div');
  modal.id = 'regionEvidenceModal';
  modal.className = 'region-evidence-modal';
  modal.innerHTML = `<div class="region-evidence-card" role="dialog" aria-modal="true" aria-labelledby="regionEvidenceTitle"><button class="region-evidence-close" type="button" aria-label="Close">×</button><div class="region-evidence-kicker">REGION EVIDENCE</div><h3 id="regionEvidenceTitle">Region</h3><div id="regionEvidenceMeta" class="region-evidence-meta"></div><div id="regionEvidenceList" class="region-evidence-list"></div><p class="region-evidence-note">Articles are source-bound public signals. Contribution values explain relative input strength; they are not probabilities.</p></div>`;
  document.body.appendChild(modal);
  modal.querySelector('.region-evidence-close').addEventListener('click', ()=>modal.classList.remove('open'));
  modal.addEventListener('click', e=>{ if(e.target === modal) modal.classList.remove('open'); });
  return modal;
}

function showRegionEvidence(regionName){
  const modal = ensureRegionEvidenceModal();
  const data = currentData?.regionEvidence?.[regionName];
  const region = (currentData?.regions || []).find(r=>r.name === regionName);
  $('regionEvidenceTitle').textContent = regionName;
  $('regionEvidenceMeta').innerHTML = data ? `<span>${Math.round(data.score || region?.score || 0)} regional risk</span><span>${Number(data.signals || 0).toFixed(1)} signals</span><span>${data.sources || 0} sources</span>` : `<span>${Math.round(region?.score || 0)} regional risk</span><span>Evidence mapping unavailable</span>`;
  const items = data?.evidence || [];
  $('regionEvidenceList').innerHTML = items.length ? items.map(item=>`<a class="region-evidence-item" href="${escapeAttr(item.url || '#')}" target="_blank" rel="noopener noreferrer"><div class="region-evidence-item-head"><b>${escapeHtml(item.source || 'Source')}</b><strong>+${Number(item.contribution || 0).toFixed(1)}</strong></div><p>${escapeHtml(item.title || 'Public signal')}</p><div class="region-evidence-tags"><span>${escapeHtml(item.primaryDriver || 'General')}</span><span>${Number(item.signals || 0).toFixed(1)} signal</span></div></a>`).join('') : '<p class="region-evidence-empty">No source-bound article evidence is currently available for this region.</p>';
  modal.classList.add('open');
}


function shortIntelText(str='', max=165){
  const clean = String(str || '').replace(/\s+/g,' ').trim();
  if(clean.length <= max) return clean;
  const first = clean.split(/(?<=[.!?])\s+/)[0];
  if(first && first.length <= max) return first;
  return clean.slice(0, max-1).replace(/\s+\S*$/, '') + '…';
}


function evidenceStrengthFromData(data){
  const r = Math.round(data.sourceHealth || 0);
  const sc = data.evidence?.sourceCount || (data.verifiedSources || []).length || 0;
  if(r >= 85 && sc >= 5) return 'HIGH';
  if(r >= 70 && sc >= 3) return 'MODERATE';
  return 'LIMITED';
}

function renderContributors(contributors){
  const el = $('contributors');
  if(!el) return;
  const list = (contributors || []).filter(c=>Number(c.signals || 0) > 0 && Number(c.sources || 0) > 0 && Number(c.score || 0) > 0).slice(0,5);
  el.innerHTML = list.map((c,i)=>`<button class="contributor-row evidence-trigger" type="button" data-region="${escapeAttr(c.name)}"><div class="ranknum">${String(i+1).padStart(2,'0')}</div><div><b>${escapeHtml(c.name)}</b><span>${escapeHtml(c.trend || 'Watch')} · ${Number(c.signals || 0).toFixed(1)} signals · ${c.sources || 0} sources</span></div><strong>+${Math.round(c.impact || 0)}</strong><div class="rankbar"><i style="width:${clamp(c.share || c.score || 0,0,100)}%"></i></div></button>`).join('') || '<p>Contributor data is being calculated.</p>';
  el.querySelectorAll('[data-region]').forEach(btn=>btn.addEventListener('click', ()=>showRegionEvidence(btn.dataset.region)));
}

function renderScoreBridge(bridge){
  const el = $('scoreBridge');
  if(!el) return;
  const raw = Number(bridge.raw ?? 0);
  const stability = Number(bridge.stability ?? 0);
  const duplicateNoise = Number(bridge.duplicateNoise ?? 0);
  const globalNormalization = Number(bridge.globalNormalization ?? 0);
  const final = Number(bridge.final ?? currentData?.score ?? 0);
  const line = (label, val) => `<div class="bridge-line"><span>${label}</span><strong>${val >= 0 ? '+' : ''}${Number(val).toFixed(1)}</strong></div>`;
  el.innerHTML = `
    <div class="bridge-main"><span>RAW</span><b>${raw.toFixed(1)}</b><em>→</em><span>INDEX</span><b>${Math.round(final)}</b></div>
    ${line('Stability adjustment', stability)}
    ${line('Duplicate / noise reduction', duplicateNoise)}
    ${line('Global synchronization', globalNormalization)}
    <p>${escapeHtml(bridge.note || 'Raw weighted drivers are adjusted before the final index is shown.')}</p>
  `;
}

function renderDrivers(drivers){
  const entries = Object.entries(drivers);
  $('drivers').innerHTML = entries.map(([k,v])=>`
    <div class="driver"><span>${k}</span><div><i style="width:${clamp(v,0,100)}%"></i></div><strong>${Math.round(v)}</strong></div>
  `).join('');
}
function renderRegions(regions){
  const el = $('regions');
  const active = (regions || []).filter(r=>Number(r.score || 0) > 0 && Number(r.signals || 0) > 0 && Number(r.sources || 0) > 0).slice(0,5);
  el.innerHTML = active.map((r,i)=>`<button class="rank evidence-trigger" type="button" data-region="${escapeAttr(r.name)}"><div class="ranknum">${String(i+1).padStart(2,'0')}</div><div><div class="rankname">${escapeHtml(r.name)}</div><div class="rankmeta">${escapeHtml(r.trend || 'Watch')} ${r.change ? `• ${escapeHtml(r.change)}` : ''} · ${Number(r.signals || 0).toFixed(1)} signals · ${r.sources || 0} sources</div></div><div class="rankscore">${Math.round(r.score)}</div><div class="rankbar"><i style="width:${clamp(r.score,0,100)}%"></i></div></button>`).join('');
  if(!active.length) el.innerHTML = '<p class="no-active-regions">No verified regional activity in the current window.</p>';
  el.querySelectorAll('[data-region]').forEach(btn=>btn.addEventListener('click', ()=>showRegionEvidence(btn.dataset.region)));
}
function renderTimeline(timeline){
  const list = (timeline || []).slice(0,5);
  $('timelineCount').textContent = `${list.length} SIGNALS`;
  $('timeline').innerHTML = list.map(t=>{ const tags=[...(t.regions||[]).slice(0,1),...(t.drivers||[]).slice(0,1)]; const tagHtml=tags.map(tag=>`<span>${escapeHtml(tag)}</span>`).join(''); const body=`<div><div class="timeline-tags">${tagHtml}</div><p>${escapeHtml(t.text||'')}</p></div>`; return t.url ? `<a class="timeline-row timeline-link" href="${escapeAttr(t.url)}" target="_blank" rel="noopener noreferrer"><time>${escapeHtml(t.time||'')}</time>${body}</a>` : `<div class="timeline-row"><time>${escapeHtml(t.time||'')}</time>${body}</div>`; }).join('');
}
function renderMetrics(m){
  $('metricConflicts').textContent = m.conflicts || '7';
  $('metricConflictsSub').textContent = m.conflictsSub || 'MONITORED';
  $('metricFlights').textContent = m.flights || 'WATCH';
  $('metricFlightsSub').textContent = m.flightsSub || 'PUBLIC SIGNALS';
  $('metricCyber').textContent = m.cyber || 'WATCH';
  $('metricCyberSub').textContent = m.cyberSub || 'LOW SURGE';
  $('metricLogistics').textContent = m.logistics || 'STABLE';
  $('metricLogisticsSub').textContent = m.logisticsSub || 'CONTAINED';
  if($('metricsNote')) $('metricsNote').textContent = m.note || 'These restate the keyword-driver scores above; there is no separate flight-tracking, cyber-threat, or shipping feed.';
}
function renderCalc(data){
  const calc = data.calculation || {};
  const weights = data.weights || { Military:.35, Diplomatic:.20, Cyber:.15, Logistics:.15, Finance:.10, Disaster:.05 };
  const drivers = data.drivers || fallback.drivers;
  const lines = Object.entries(drivers).map(([k,v])=>({ name:k, value:v, weight:weights[k]||0, contribution:v*(weights[k]||0) }));
  const raw = calc.raw ?? lines.reduce((s,l)=>s+l.contribution,0);
  const containment = calc.containment ?? ((calc.stability || 0) + (calc.duplicateNoise || 0) + (calc.globalNormalization || 0));
  const final = calc.final ?? data.score;
  $('rawScore').textContent = `RAW ${Math.round(raw*10)/10}`;
  $('calcDetail').innerHTML = lines.map(l=>`
    <div class="calc-line"><b>${l.name}</b><span>${Math.round(l.value)} × ${l.weight.toFixed(2)}</span><em>${l.contribution.toFixed(1)}</em></div>
  `).join('') + `
    <div class="calc-total"><span>RAW SCORE</span><strong>${raw.toFixed(1)}</strong></div>
    <div class="calc-total"><span>STABILITY ADJUSTMENT</span><strong>${Number(calc.stability || 0).toFixed(1)}</strong></div>
    <div class="calc-total"><span>DUPLICATE / NOISE</span><strong>${Number(calc.duplicateNoise || 0).toFixed(1)}</strong></div>
    <div class="calc-total"><span>GLOBAL SYNC</span><strong>${Number(calc.globalNormalization || 0).toFixed(1)}</strong></div>
    <div class="calc-total"><span>TOTAL ADJUSTMENT</span><strong>${Number(containment).toFixed(1)}</strong></div>
    <div class="calc-total"><span>FINAL SCORE</span><strong>${Math.round(final)}</strong></div>
    ${renderAdjustmentReasons(calc.adjustmentReasons || [])}
    ${renderReasoning(calc.reasoning || [])}
  `;
}
function renderAdjustmentReasons(reasons){
  if(!Array.isArray(reasons) || !reasons.length) return '';
  // FIX (transparency): previously the -1.0 / -3.0 / +0.0 adjustment numbers
  // shown in "WHY SCORE?" had no explanation attached — the person had to
  // trust the number with no way to see which rule produced it. Each reason
  // string here corresponds to one specific if/else branch that actually
  // fired in stabilityAdjustment / duplicateNoiseReduction /
  // globalSynchronizationAdjustment on the backend, phrased in plain language.
  return `<div class="reasoning-title">WHY THESE ADJUSTMENTS</div>` +
    `<ul class="adjustment-reasons">${reasons.map(r=>`<li>${escapeHtml(r)}</li>`).join('')}</ul>`;
}
function renderReasoning(reasoning){
  if(!Array.isArray(reasoning) || !reasoning.length) return '';
  return `<div class="reasoning-title">AI REASONING</div>` + reasoning.slice(0,6).map(r=>{
    const delta = Number(r.delta || 0);
    const sign = delta >= 0 ? '+' : '';
    return `<div class="reason-line"><b>${escapeHtml(r.label || 'Signal')}</b><span>${sign}${delta}</span><p>${escapeHtml(r.text || '')}</p></div>`;
  }).join('');
}
async function loadRisk(){
  try{
    const res = await fetch('/api/risk?t=' + Date.now(), { cache:'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    render(data.ok ? data : fallback);
  }catch(err){
    console.warn('ORACLE fallback', err);
    render({ ...fallback, updatedAt:new Date().toISOString(), aiMode:'FALLBACK' });
  }
}
function textPool(d){
  const event = d.topEvent || fallback.topEvent;
  return [
    event.title, event.summary, d.assessment, d.brief,
    ...(d.regions || []).map(r=>r.name),
    ...(d.facts || []), ...(d.keyDrivers || []), ...(d.watchNext || []), d.outlookText
  ].join(' ').toLowerCase();
}

function uniqueTags(tags, limit=16){
  const seen = new Set();
  return tags
    .filter(Boolean)
    .map(t => t.startsWith('#') ? t : `#${t}`)
    .filter(t => {
      const key = t.toLowerCase();
      if(seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function dynamicTags(d, lang='en'){
  const t = textPool(d);
  const baseGlobal = ['#ORACLE','#WorldRiskIndex','#GlobalRisk','#AIAnalysis','#OSINT'];
  const baseJapanese = ['#ORACLE','#世界情勢','#国際情勢','#AI分析','#世界リスク'];
  const topical = [];

  if(/ukraine|kyiv|kiev|russia|nato/.test(t)) topical.push('#Ukraine','#Russia','#NATO');
  if(/taiwan|taipei|strait|china|south china sea/.test(t)) topical.push('#Taiwan','#China','#SouthChinaSea');
  if(/iran|israel|gaza|middle east|hezbollah|houthi|red sea/.test(t)) topical.push('#Iran','#Israel','#MiddleEast');
  if(/cyber|hack|malware|ransomware|data breach|ddos/.test(t)) topical.push('#CyberSecurity','#CyberAttack');
  if(/earthquake|volcano|tsunami|flood|wildfire|storm|hurricane|typhoon/.test(t)) topical.push('#Earthquake','#Disaster','#USGS');
  if(/shipping|port|tanker|supply chain|logistics|vessel|canal/.test(t)) topical.push('#SupplyChain','#Logistics','#Maritime');
  if(/oil|gas|market|inflation|stocks|bond|currency|finance/.test(t)) topical.push('#Markets','#Energy','#Finance');
  if(/military|missile|drone|airstrike|troops|navy|air force|strike/.test(t)) topical.push('#Military','#Defense','#Geopolitics');

  if(lang === 'ja'){
    return uniqueTags([...baseJapanese, ...topical, '#地政学', '#危機管理'], 15);
  }
  return uniqueTags([...baseGlobal, ...topical, '#Geopolitics', '#Intelligence'], 16);
}

function generatePost(lang='en'){
  const d = currentData || fallback;
  const event = d.topEvent || fallback.topEvent;
  const regions = (d.regions || fallback.regions).slice(0,3);
  const score = d.score ?? fallback.score;
  const state = d.state || stateFromScore(score);
  const outlook = d.outlook24h ? `\n24H Outlook: ${d.outlook24h}` : '';

  // FIX (duplicate hashtags): the AI-generated post text (xPostGlobal /
  // xPostJapanese) sometimes already contains hashtags of its own, since
  // nothing stops the model from adding them even though a separate
  // `hashtags` field was also requested. This function used to blindly
  // append the full dynamicTags() list regardless, so any tag the AI text
  // already included (e.g. #ORACLE) would show up twice in the final post.
  // Now we drop any tag from the appended list that's already present
  // (case-insensitive) in the base post text.
  const dedupeTagsAgainstText = (text, tagList) => {
    const lower = String(text || '').toLowerCase();
    return tagList.filter(tag => !lower.includes(tag.toLowerCase()));
  };

  if(lang === 'ja'){
    if(d.xPostJapanese && typeof d.xPostJapanese === 'string'){
      const base = d.xPostJapanese.trim();
      const tags = dedupeTagsAgainstText(base, dynamicTags(d, lang)).join(' ');
      return `${base}\n\nhttps://oracle-rho-flax.vercel.app\n\n${tags}`;
    }
    const regionText = regions.map((r,i)=>`${i+1}. ${r.name} ${Math.round(r.score)}`).join('\n');
    const base = `ORACLE | World Risk Intelligence\n\n\u4e16\u754c\u30ea\u30b9\u30af\u6307\u6570: ${score}\uff08${state}\uff09${outlook ? outlook.replace('24H Outlook:', '\n24\u6642\u9593\u898b\u901a\u3057:') : ''}\n\nTop Event\n${event.title}\n${event.summary || ''}\n\nHot Regions\n${regionText}\n\nAI Assessment\n${d.assessment || fallback.assessment}\n\nContinuously updated.`;
    const tags = dedupeTagsAgainstText(base, dynamicTags(d, lang)).join(' ');
    return `${base}\nhttps://oracle-rho-flax.vercel.app\n\n${tags}`;
  }

  const aiPost = d.xPostGlobal || d.xPost;
  if(aiPost && typeof aiPost === 'string'){
    const base = aiPost.trim();
    const tags = dedupeTagsAgainstText(base, dynamicTags(d, lang)).join(' ');
    return `${base}\n\nhttps://oracle-rho-flax.vercel.app\n\n${tags}`;
  }

  const regionText = regions.map((r,i)=>`${i+1}. ${r.name} ${Math.round(r.score)}`).join('\n');
  const base = `ORACLE | World Risk Intelligence\n\nORACLE Index: ${score} (${state})${outlook}\n\nTop Event\n${event.title}\n${event.summary || ''}\n\nHot Regions\n${regionText}\n\nAI Assessment\n${d.assessment || fallback.assessment}\n\nContinuously updated.`;
  const tags = dedupeTagsAgainstText(base, dynamicTags(d, lang)).join(' ');
  return `${base}\nhttps://oracle-rho-flax.vercel.app\n\n${tags}`;
}
function setup(){
  const params = new URLSearchParams(location.search);
  // Reverted per request: no ADMIN_TOKEN / server round-trip needed anymore.
  // Any `?admin=...` (any value) in the URL unlocks the panel client-side.
  // NOTE: this means anyone who has or guesses this URL can open the admin
  // panel — there is no real access control here. Acceptable for a personal,
  // non-commercial project as long as the URL itself isn't shared publicly.
  if(params.get('admin')) $('adminPanel')?.classList.add('open');
  $('whyBtn').addEventListener('click', ()=> $('scoreModal').classList.add('open'));
  $('shareCardBtn')?.addEventListener('click', handleShareCard);
  $('closeModal').addEventListener('click', ()=> $('scoreModal').classList.remove('open'));
  $('scoreModal').addEventListener('click', (e)=>{ if(e.target.id === 'scoreModal') $('scoreModal').classList.remove('open'); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape') $('scoreModal').classList.remove('open'); });
  $('refreshBtn')?.addEventListener('click', loadRisk);
  $('makeGlobalPostBtn')?.addEventListener('click', ()=> $('postText').value = generatePost('en'));
  $('makeJapanesePostBtn')?.addEventListener('click', ()=> $('postText').value = generatePost('ja'));
  $('copyPostBtn')?.addEventListener('click', async ()=>{ await navigator.clipboard.writeText($('postText').value || generatePost('en')); });
  loadRisk();
  setInterval(loadRisk, 60000);
}
setup();
