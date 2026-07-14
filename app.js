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
  dataMode: 'fallback',
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
  $('confidence').textContent = `EVIDENCE STRENGTH ${currentData.evidenceStrength || evidenceStrengthFromData(currentData)}`;
  $('confidenceBar').style.width = `${clamp(currentData.sourceHealth || currentData.confidence || 70,0,100)}%`;
  renderContributors(currentData.contributors || fallback.contributors || []);
  renderScoreBridge(currentData.scoreBridge || fallback.scoreBridge || {});
  $('aiMode').textContent = currentData.aiMode || (currentData.aiUsed ? 'LLM ASSISTED' : 'RULE BASED');
  $('sourceHealth').textContent = `${Math.round(currentData.sourceHealth || 90)}%`;

  const e = currentData.topEvent || fallback.topEvent;
  $('eventSource').textContent = e.source || 'SOURCE';
  $('eventTitle').textContent = e.title || 'Monitoring public signals';
  $('eventSummary').textContent = e.summary || '';
  $('eventLink').href = e.url || '#';

  renderDrivers(currentData.drivers || fallback.drivers);
  renderRegions(currentData.regions || fallback.regions);
  renderTimeline(currentData.timeline || fallback.timeline);
  renderMetrics(currentData.metrics || fallback.metrics);
  renderDataSources(currentData);
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
function renderSourceConfidence(sc){
  const el = $('sourceConfidence');
  if(!el) return;
  const available = (sc.availableSources || []).slice(0,8).map(s=>`<b>${escapeHtml(s)}</b>`).join('');
  const limited = (sc.limitedSources || []).slice(0,5).map(s=>`<em>${escapeHtml(s)}</em>`).join('');
  el.innerHTML = `<div class="source-pillset">${available || '<b>Public Sources</b>'}${limited ? limited : ''}</div><p>${escapeHtml(sc.note || 'Source confidence is being monitored.')}</p>`;
}

// FIX: removed renderVerifiedSources(). Its target element (#verifiedSources)
// was already marked `hidden` in index.html — someone clearly intended this
// to not be shown — but `.source-pillset{display:flex}` in style.css was
// overriding that (a class selector on display always beats the browser's
// default `[hidden]{display:none}` UA rule unless the author CSS accounts
// for it), so it rendered anyway as a second, near-identical checkmarked
// source list directly below the EVIDENCE card's real one (#evidenceSourceList,
// which already covers the same data via renderEvidence's fallback to
// data.verifiedSources). The element and its render call are removed rather
// than just patched, since it was fully redundant to begin with.

function renderEvidence(data){
  const ev = data.evidence || {};
  const sources = Array.isArray(ev.sources) && ev.sources.length ? ev.sources : (data.verifiedSources || []);
  const sourceCount = ev.sourceCount || sources.length || 1;
  const articleCount = ev.articleCount || data.articleCount || 0;
  const reliability = Math.round(ev.reliability || data.sourceHealth || 70);
  const checks = ev.crossChecks || Math.max(1, Math.min(3, sourceCount - 1));
  if($('evidenceSources')) $('evidenceSources').textContent = `${sourceCount} SOURCES`;
  if($('evidenceChecks')) $('evidenceChecks').textContent = `${checks} CROSS CHECKS`;
  if($('evidenceArticles')) $('evidenceArticles').textContent = `${articleCount} SIGNALS`;
  if($('evidenceReliability')) $('evidenceReliability').textContent = `${reliability}%`;
  if($('evidenceSourceList')) {
    const mode = data.dataMode || ev.dataMode || 'live';
    const factor = ev.factors ? `<small class="evidence-factors">Mode: ${escapeHtml(mode.toUpperCase())} · Diversity ${ev.factors.sourceDiversity}% · Freshness ${ev.factors.freshness}% · Completeness ${ev.factors.completeness}% · Agreement ${ev.factors.consensus}%</small>` : '';
    const status = Array.isArray(ev.status) && ev.status.length ? `<small class="evidence-factors">${ev.status.slice(0,5).map(x=>`${escapeHtml(x.name)}:${escapeHtml(x.status)}`).join(' · ')}</small>` : '';
    $('evidenceSourceList').innerHTML = (sources.slice(0,8).map(s=>`<b>✓ ${escapeHtml(s)}</b>`).join('') || '<em>Public sources monitored</em>') + factor + status;
  }
}

function escapeHtml(str=''){
  return String(str).replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
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

function renderDataSources(data){
  const el = $('dataSources');
  if(!el) return;
  // FIX: this list used to be static HTML hardcoded in index.html, including
  // NASA, MarineTraffic, and FlightRadar24 — three services this project has
  // never actually called anywhere in api/risk.js. Every pill also always
  // showed a green "connected" dot regardless of any real status. Now it's
  // rendered from the same sourceConfidence data already used elsewhere
  // (real availableSources vs limitedSources), so it can never claim a feed
  // is live when nothing was ever fetched from it.
  const sc = data.sourceConfidence || fallback.sourceConfidence || {};
  const available = Array.isArray(sc.availableSources) ? sc.availableSources : [];
  const limited = Array.isArray(sc.limitedSources) ? sc.limitedSources : [];
  const availHtml = available.slice(0,8).map(s=>`<b>${escapeHtml(s)} <i></i></b>`).join('');
  const limitedHtml = limited.slice(0,5).map(s=>`<b class="limited">${escapeHtml(s)} <i></i></b>`).join('');
  el.innerHTML = (availHtml + limitedHtml) || '<b>Public sources <i></i></b>';
}
function renderContributors(contributors){
  const el = $('contributors');
  if(!el) return;
  const list = (contributors || []).slice(0,5);
  el.innerHTML = list.map((c,i)=>{
    const impact = Math.round(c.impact || 0);
    const signals = c.signals !== undefined ? `${Number(c.signals).toFixed(1)} signals` : `${Math.round(c.share || 0)}% signal share`;
    const sources = c.sources !== undefined ? `${c.sources} source${c.sources === 1 ? '' : 's'}` : 'source mix tracked';
    return `
    <div class="contributor-row">
      <div class="ranknum">${String(i+1).padStart(2,'0')}</div>
      <div><b>${escapeHtml(c.name)}</b><span>${escapeHtml(c.trend || 'Watch')} · ${signals} · ${sources}</span></div>
      <strong>+${impact}<small> pts</small></strong>
      <div class="rankbar"><i style="width:${clamp(impact * 4,0,100)}%"></i></div>
    </div>`;
  }).join('') || '<p>Contributor data is being calculated.</p>';
}

function renderScoreBridge(bridge){
  const el = $('scoreBridge');
  if(!el) return;
  const raw = Number(bridge.raw ?? 0);
  const stability = Number(bridge.stability ?? 0);
  const duplicateNoise = Number(bridge.duplicateNoise ?? 0);
  const globalNormalization = Number(bridge.globalNormalization ?? 0);
  const final = Number(bridge.final ?? currentData?.score ?? 0);
  const line = (label, val, note='') => `<div class="bridge-line"><span>${label}${note ? `<small>${escapeHtml(note)}</small>` : ''}</span><strong>${val >= 0 ? '+' : ''}${Number(val).toFixed(1)}</strong></div>`;
  // FIX: this used to read bridge.stabilityDetails / bridge.duplicate.note /
  // bridge.global.reason / bridge.formula, none of which risk.js ever sent —
  // so every line always fell back to the same 3 generic captions regardless
  // of what actually happened that cycle. risk.js now sends stabilityNote /
  // duplicateNote / globalNote directly, matching what's read here.
  const stabilityNote = bridge.stabilityNote || 'Primary driver and containment checks';
  const duplicateNote = bridge.duplicateNote || 'Duplicate handling produced no reduction for this cycle.';
  const globalNote = bridge.globalNote || 'Cross-region normalization based on active regional contributor distribution.';
  el.innerHTML = `
    <div class="bridge-main"><span>RAW</span><b>${raw.toFixed(1)}</b><em>→</em><span>INDEX</span><b>${Math.round(final)}</b></div>
    ${line('Stability adjustment', stability, stabilityNote)}
    ${line('Duplicate / noise reduction', duplicateNoise, duplicateNote)}
    ${line('Global synchronization', globalNormalization, globalNote)}
    <div class="formula-box">
      <b>WHY ${Math.round(final)}?</b>
      <p>${escapeHtml(bridge.note || 'Raw weighted drivers are adjusted before the final index is shown.')}</p>
    </div>
  `;
}

function renderDrivers(drivers){
  const evidence = currentData?.driverEvidence || {};
  const entries = Object.entries(drivers);
  $('drivers').innerHTML = entries.map(([k,v])=>{
    const ev = evidence[k] || {};
    const sub = ev.basis ? `<small>${escapeHtml(ev.basis)} · +${Number(ev.contribution||0).toFixed(1)} pts</small>` : `<small>Evidence score, not probability</small>`;
    return `<div class="driver driver-evidence"><span>${k}${sub}</span><div><i style="width:${clamp(v,0,100)}%"></i></div><strong>${Math.round(v)}</strong></div>`;
  }).join('');
}
function renderRegions(regions){
  $('regions').innerHTML = regions.slice(0,5).map((r,i)=>`
    <div class="rank">
      <div class="ranknum">${String(i+1).padStart(2,'0')}</div>
      <div><div class="rankname">${r.name}</div><div class="rankmeta">Regional risk · ${r.trend || 'Watch'} ${r.change ? `• 24h ${r.change}` : ''}</div></div>
      <div class="rankscore">${Math.round(r.score)}</div>
      <div class="rankbar"><i style="width:${clamp(r.score,0,100)}%"></i></div>
    </div>
  `).join('');
}
function renderTimeline(timeline){
  const list = (timeline || []).slice(0,5);
  $('timelineCount').textContent = `${list.length} SIGNALS`;
  $('timeline').innerHTML = list.map(t=>`<div class="timeline-row"><time>${t.time}</time><p>${t.text}</p></div>`).join('');
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
  // FIX: risk.js has always computed metrics.note (the disclosure that these
  // tiles restate the Military/Cyber/Logistics driver scores above, and that
  // there's no separate flight-tracking/cyber-threat/shipping feed behind
  // them), but nothing ever rendered it — so "MILITARY FLIGHTS: ELEVATED"
  // still reads like a real dedicated feed with zero disclosure in sight.
  if($('metricsNote')) $('metricsNote').textContent = m.note || '';
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
    ${renderReasoning(calc.reasoning || [])}
  `;
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
  // FIX: previously this pool also included d.facts, d.keyDrivers, d.watchNext,
  // and region names. That was the actual cause of "irrelevant hashtags":
  // - d.facts always contains a fixed boilerplate sentence that literally
  //   spells out "military, diplomatic, cyber, logistics, finance, and
  //   disaster categories" verbatim on every single cycle, regardless of
  //   what's actually happening — so #Logistics, #Finance, #Military, etc.
  //   were firing on every post whether or not those topics were real.
  // - d.keyDrivers / d.watchNext are literally driver label arrays (e.g.
  //   "Logistics", "Finance") — the label itself trivially matches the same
  //   regex used to decide whether to tag that category, so merely listing
  //   a driver (even at a low, unremarkable score) guaranteed its hashtag.
  // - region names (d.regions.map(r=>r.name)) caused the same self-matching
  //   for every active region regardless of how prominent it actually was.
  // Now the pool is built only from text that's genuinely specific to what
  // happened this cycle: the actual top event, the AI's assessment/brief,
  // and the outlook — not fixed labels or boilerplate.
  return [
    event.title, event.summary, d.assessment, d.brief, d.outlookText
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
  // FIX: previously up to 16 tags were allowed (5-7 base + up to 3 per
  // topical match, several categories could match at once). Every hashtag
  // costs real characters against X's 280-character limit, and the old
  // template was already ~900 characters before hashtags were even counted.
  // Cut to a firm max of 4 total: 2 base + up to 2 topical, so hashtags
  // can't silently eat the post's character budget.
  const baseGlobal = ['#ORACLE','#WorldRiskIndex'];
  const baseJapanese = ['#ORACLE','#世界リスク'];
  const topical = [];

  if(/ukraine|kyiv|kiev|russia|nato/.test(t)) topical.push('#Ukraine');
  // FIX: removed the bare word 'strait' from Taiwan matching — the same
  // over-matching bug already fixed in risk.js's REGION_KEYWORDS. A generic
  // "strait" also appears in "Strait of Hormuz" (Middle East), which was
  // adding a #Taiwan tag to stories that had nothing to do with Taiwan.
  if(/taiwan|taipei|taiwan strait|strait of taiwan|formosa strait|south china sea/.test(t)) topical.push('#Taiwan');
  if(/iran|israel|gaza|middle east|hezbollah|houthi|red sea/.test(t)) topical.push('#MiddleEast');
  if(/cyber|hack|malware|ransomware|data breach|ddos/.test(t)) topical.push('#CyberSecurity');
  if(/earthquake|volcano|tsunami|flood|wildfire|storm|hurricane|typhoon/.test(t)) topical.push('#Disaster');
  if(/shipping|port|tanker|supply chain|logistics|vessel|canal/.test(t)) topical.push('#SupplyChain');
  if(/oil|gas|market|inflation|stocks|bond|currency|finance/.test(t)) topical.push('#Markets');
  if(/military|missile|drone|airstrike|troops|navy|air force|strike/.test(t)) topical.push('#Military');

  if(lang === 'ja'){
    return uniqueTags([...baseJapanese, ...topical], 4);
  }
  return uniqueTags([...baseGlobal, ...topical], 4);
}

// FIX: previously the disclaimer only lived in the page footer, which
// doesn't travel with a screenshot or a copied post. Per discussion, the
// safest place for it is baked into the post text itself, appended right
// before the link/hashtags on every single generated post — AI-generated
// or fallback, English or Japanese — so it can't be forgotten or edited out
// by accident. Kept short since it competes with the body for the same
// 280-character budget.
const POST_DISCLAIMER_EN = 'Automated headline analysis, not a forecast.';
const POST_DISCLAIMER_JA = '見出しの自動分析であり、予測ではありません。';
const SITE_URL = 'https://oracle-rho-flax.vercel.app';
const X_POST_LIMIT = 280;

// FIX: approximates X's character counting well enough for client-side
// budgeting — any URL counts as a flat 23 characters (X wraps all links in
// its t.co shortener, regardless of actual length), everything else counts
// as 1 character per code point. This is not byte-perfect (X's real counter
// also weight CJK characters and some Unicode ranges differently), so a
// safety margin is intentional here, not just precision.
function xWeightedLength(str){
  const urlRe = /https?:\/\/\S+/g;
  const urlCount = (str.match(urlRe) || []).length;
  const withoutUrls = str.replace(urlRe, '');
  return withoutUrls.length + urlCount * 23;
}

function generatePost(lang='en'){
  const d = currentData || fallback;
  const event = d.topEvent || fallback.topEvent;
  const topRegion = (d.regions || fallback.regions)[0];
  const tags = dynamicTags(d, lang).join(' ');
  const score = d.score ?? fallback.score;
  const state = d.state || stateFromScore(score);

  // FIX: this used to assemble a multi-section report (Top Event / Hot
  // Regions / AI Assessment / "Continuously updated.") that ran to several
  // hundred characters on its own, then added a disclaimer, link, and up to
  // 16 hashtags on top — routinely landing around 900 characters against a
  // 280-character limit. The AI-generated path is now prompted for a much
  // shorter body (see risk.js), and this fallback path (used when the AI
  // call didn't return a usable post) is now a single compact line instead
  // of a full report. A hard truncation below is the actual guarantee,
  // this compact template just means truncation rarely has to do much work.
  const finish = (body, disclaimer) => {
    const tail = `\n\n${disclaimer}\n\n${SITE_URL}\n\n${tags}`;
    const tailWeight = xWeightedLength(tail);
    const bodyBudget = Math.max(20, X_POST_LIMIT - tailWeight);
    const trimmedBody = xWeightedLength(body) > bodyBudget
      ? body.slice(0, bodyBudget - 1).replace(/\s+\S*$/, '') + '…'
      : body;
    return `${trimmedBody}${tail}`;
  };

  if(lang === 'ja'){
    if(d.xPostJapanese && typeof d.xPostJapanese === 'string') return finish(d.xPostJapanese.trim(), POST_DISCLAIMER_JA);
    const body = `世界リスク指数 ${score}（${state}）。最大の焦点: ${topRegion?.name || 'Global'}。${event.title}`;
    return finish(body, POST_DISCLAIMER_JA);
  }

  const aiPost = d.xPostGlobal || d.xPost;
  if(aiPost && typeof aiPost === 'string'){
    return finish(aiPost.trim(), POST_DISCLAIMER_EN);
  }

  const body = `Global Risk Index ${score} (${state}). Top focus: ${topRegion?.name || 'Global'}. ${event.title}`;
  return finish(body, POST_DISCLAIMER_EN);
}

function ensureAdminPanel(){
  let panel = $('adminPanel');
  if(panel) return panel;
  const footer = document.querySelector('.footer');
  panel = document.createElement('section');
  panel.className = 'admin';
  panel.id = 'adminPanel';
  panel.innerHTML = `
    <div class="card-head"><b>ADMIN TERMINAL</b><span>PRIVATE MODE</span></div>
    <div class="admin-buttons">
      <button id="refreshBtn" type="button">REFRESH NOW</button>
      <button id="makeGlobalPostBtn" type="button">GLOBAL POST</button>
      <button id="makeJapanesePostBtn" type="button">JAPANESE POST</button>
      <button id="copyPostBtn" type="button">COPY</button>
    </div>
    <textarea id="postText" rows="9" placeholder="Generated post will appear here."></textarea>
    <div id="copyStatus" class="copy-status" aria-live="polite"></div>
    <pre id="debugBox"></pre>`;
  if(footer) footer.before(panel); else document.querySelector('main')?.append(panel);
  return panel;
}

async function copyGeneratedPost(){
  const box = $('postText');
  const status = $('copyStatus');
  const text = box?.value || generatePost('en');
  if(box && !box.value) box.value = text;
  try{
    await navigator.clipboard.writeText(text);
    if(status) status.textContent = 'COPIED';
  }catch{
    if(box){ box.focus(); box.select(); document.execCommand('copy'); }
    if(status) status.textContent = 'COPIED';
  }
  setTimeout(()=>{ if(status) status.textContent=''; }, 1800);
}

// NOTE (tradeoff, explicit by request): this is back to a simple client-side
// URL parameter check with no server-side verification — anyone who knows or
// guesses the param value can open the admin panel. /api/admin-auth.js still
// exists and still works if called, but nothing here calls it anymore. This
// is acceptable ONLY as long as the admin panel keeps doing low-stakes things
// (triggering a refresh, generating draft social post text). If it ever
// starts doing anything more sensitive, this needs to go back to a real
// server-side check.
function checkAdminAccess(){
  const params = new URLSearchParams(location.search);
  return params.get('admin') === 'doom';
}

function setup(){
  const isAdmin = checkAdminAccess();
  const panel = isAdmin ? ensureAdminPanel() : $('adminPanel');
  if(isAdmin) panel?.classList.add('open');
  // FIX (accessibility): the modal's aria-hidden="true" was set once in the
  // HTML and never updated when JS toggled the .open class, so a screen
  // reader would always announce the dialog as hidden even while it was
  // visually open — and closing it never returned focus anywhere, so
  // keyboard/screen-reader users would lose their place. Now aria-hidden and
  // focus move together with the visual open/close state.
  const openScoreModal = () => {
    const modal = $('scoreModal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    $('closeModal')?.focus();
  };
  const closeScoreModal = () => {
    const modal = $('scoreModal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    $('whyBtn')?.focus();
  };
  $('whyBtn').addEventListener('click', openScoreModal);
  $('closeModal').addEventListener('click', closeScoreModal);
  $('scoreModal').addEventListener('click', (e)=>{ if(e.target.id === 'scoreModal') closeScoreModal(); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape' && $('scoreModal').classList.contains('open')) closeScoreModal(); });
  $('refreshBtn')?.addEventListener('click', loadRisk);
  $('makeGlobalPostBtn')?.addEventListener('click', ()=>{
    if(currentData?.isBaseline){
      $('postText').value = '⚠️ BASELINE MODE — no live sources are reachable right now. Do not post; this data is illustrative placeholder text, not real reporting.';
      return;
    }
    $('postText').value = generatePost('en');
  });
  $('makeJapanesePostBtn')?.addEventListener('click', ()=>{
    if(currentData?.isBaseline){
      $('postText').value = '⚠️ ベースラインモードです(実データ取得不可)。この内容は投稿しないでください — 実際の報道ではなくダミーの説明文です。';
      return;
    }
    $('postText').value = generatePost('ja');
  });
  $('copyPostBtn')?.addEventListener('click', copyGeneratedPost);
  loadRisk();
  setInterval(loadRisk, 60000);
}
setup();
