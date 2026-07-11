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
function render(data){
  currentData = data || fallback;
  const score = clamp(currentData.score, 0, 100);
  const prev = clamp(currentData.previousScore ?? score, 0, 100);
  const diff = Math.round(score - prev);
  const state = currentData.state || stateFromScore(score);
  $('score').textContent = score;
  $('state').textContent = state;
  $('delta').textContent = `${diff >= 0 ? '▲ +' : '▼ '}${Math.abs(diff)} / 24H`;
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
  if($('cacheNote')){
    const ttl = currentData.cacheTtlMinutes;
    $('cacheNote').textContent = ttl
      ? `Source data may be cached up to ${ttl} min`
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
  const sourceCount = ev.sourceCount || sources.length || 1;
  const articleCount = ev.articleCount || data.articleCount || 0;
  const reliability = Math.round(ev.reliability || data.sourceHealth || 70);
  const checks = ev.crossChecks || Math.max(1, Math.min(3, sourceCount - 1));
  if($('evidenceSources')) $('evidenceSources').textContent = `${sourceCount} SOURCES`;
  if($('evidenceChecks')) $('evidenceChecks').textContent = `${checks} CROSS CHECKS`;
  if($('evidenceArticles')) $('evidenceArticles').textContent = `${articleCount} SIGNALS`;
  if($('evidenceReliability')) $('evidenceReliability').textContent = `${reliability}%`;
  if($('evidenceSourceList')) $('evidenceSourceList').innerHTML = (sources.slice(0,8).map(s=>`<b>✓ ${escapeHtml(s)}</b>`).join('') || '<em>Public sources monitored</em>') + `<small class="evidence-definition">Reliability estimate reflects active feed coverage, source diversity, signal volume, and feed health. Cross checks indicate independent source groups, not fact-check verdicts.</small>`;
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
  const tags = dynamicTags(d, lang).join(' ');
  const score = d.score ?? fallback.score;
  const state = d.state || stateFromScore(score);
  const outlook = d.outlook24h ? `\n24H Outlook: ${d.outlook24h}` : '';

  // FIX: the on-page disclaimer banner only reaches people who visit the
  // site itself. A tweet is often read standalone, without the link ever
  // being opened, so the same "experimental, not verified" context needs to
  // travel with the post text itself, not just live on the webpage.
  const disclaimerEn = '(Experimental hobby project \u2014 heuristic scoring, not verified analysis. Not real intelligence.)';
  const disclaimerJa = '(\u500b\u4eba\u306e\u8da3\u5473\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u3067\u3059\u3002\u6570\u5024\u306f\u30d2\u30e5\u30fc\u30ea\u30b9\u30c6\u30a3\u30c3\u30af\u306b\u3088\u308b\u7c21\u6613\u30b9\u30b3\u30a2\u3067\u3001\u691c\u8a3c\u6e08\u307f\u306e\u5206\u6790\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002)';

  if(lang === 'ja'){
    if(d.xPostJapanese && typeof d.xPostJapanese === 'string') return `${d.xPostJapanese.trim()}\n\n${disclaimerJa}\n\nhttps://oracle-rho-flax.vercel.app\n\n${tags}`;
    const regionText = regions.map((r,i)=>`${i+1}. ${r.name} ${Math.round(r.score)}`).join('\n');
    return `ORACLE | World Risk Intelligence\n\n\u4e16\u754c\u30ea\u30b9\u30af\u6307\u6570: ${score}\uff08${state}\uff09${outlook ? outlook.replace('24H Outlook:', '\n24\u6642\u9593\u898b\u901a\u3057:') : ''}\n\nTop Event\n${event.title}\n${event.summary || ''}\n\nHot Regions\n${regionText}\n\nAI Assessment\n${d.assessment || fallback.assessment}\n\n${disclaimerJa}\n\nContinuously updated.\nhttps://oracle-rho-flax.vercel.app\n\n${tags}`;
  }

  const aiPost = d.xPostGlobal || d.xPost;
  if(aiPost && typeof aiPost === 'string'){
    return `${aiPost.trim()}\n\n${disclaimerEn}\n\nhttps://oracle-rho-flax.vercel.app\n\n${tags}`;
  }

  const regionText = regions.map((r,i)=>`${i+1}. ${r.name} ${Math.round(r.score)}`).join('\n');
  return `ORACLE | World Risk Intelligence\n\nGlobal Risk Index: ${score} (${state})${outlook}\n\nTop Event\n${event.title}\n${event.summary || ''}\n\nHot Regions\n${regionText}\n\nAI Assessment\n${d.assessment || fallback.assessment}\n\n${disclaimerEn}\n\nContinuously updated.\nhttps://oracle-rho-flax.vercel.app\n\n${tags}`;
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
