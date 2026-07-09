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
  updatedAt: new Date().toISOString(),
  sourceHealth: 88,
  aiMode: 'RULE BASED',
  brief: 'Regional tensions remain elevated. Global escalation risk remains contained.',
  assessment: 'AI-assisted rules detected elevated regional pressure without synchronized global escalation.',
  topEvent: { title: 'Global signals under monitoring', summary: 'Public signals indicate localized pressure across monitored regions.', source: 'GDELT', url: 'https://www.gdeltproject.org/' },
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
  $('brief').textContent = currentData.brief || fallback.brief;
  $('assessment').textContent = currentData.assessment || fallback.assessment;
  $('confidence').textContent = `${Math.round(currentData.confidence || 70)}%`;
  $('confidenceBar').style.width = `${clamp(currentData.confidence || 70,0,100)}%`;
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
  renderCalc(currentData);
  if($('debugBox')) $('debugBox').textContent = JSON.stringify(currentData, null, 2);
  lastLoadedAt = Date.now();
}
function renderDrivers(drivers){
  const entries = Object.entries(drivers);
  $('drivers').innerHTML = entries.map(([k,v])=>`
    <div class="driver"><span>${k}</span><div><i style="width:${clamp(v,0,100)}%"></i></div><strong>${Math.round(v)}</strong></div>
  `).join('');
}
function renderRegions(regions){
  $('regions').innerHTML = regions.slice(0,5).map((r,i)=>`
    <div class="rank">
      <div class="ranknum">${String(i+1).padStart(2,'0')}</div>
      <div><div class="rankname">${r.name}</div><div class="rankmeta">${r.trend || 'Watch'} ${r.change ? `• ${r.change}` : ''}</div></div>
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
}
function renderCalc(data){
  const calc = data.calculation || {};
  const weights = data.weights || { Military:.35, Diplomatic:.20, Cyber:.15, Logistics:.15, Finance:.10, Disaster:.05 };
  const drivers = data.drivers || fallback.drivers;
  const lines = Object.entries(drivers).map(([k,v])=>({ name:k, value:v, weight:weights[k]||0, contribution:v*(weights[k]||0) }));
  const raw = calc.raw ?? lines.reduce((s,l)=>s+l.contribution,0);
  const containment = calc.containment ?? (data.containment ?? -4);
  const final = calc.final ?? data.score;
  $('rawScore').textContent = `RAW ${Math.round(raw*10)/10}`;
  $('calcDetail').innerHTML = lines.map(l=>`
    <div class="calc-line"><b>${l.name}</b><span>${Math.round(l.value)} × ${l.weight.toFixed(2)}</span><em>${l.contribution.toFixed(1)}</em></div>
  `).join('') + `
    <div class="calc-total"><span>RAW SCORE</span><strong>${raw.toFixed(1)}</strong></div>
    <div class="calc-total"><span>STABILITY ADJUSTMENT</span><strong>${Number(containment).toFixed(1)}</strong></div>
    <div class="calc-total"><span>FINAL SCORE</span><strong>${Math.round(final)}</strong></div>
  `;
}
async function loadRisk(){
  try{
    const res = await fetch('/api/risk', { cache:'default' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    render(data.ok ? data : fallback);
  }catch(err){
    console.warn('ORACLE fallback', err);
    render({ ...fallback, updatedAt:new Date().toISOString(), aiMode:'FALLBACK' });
  }
}
function generatePost(){
  const d = currentData || fallback;
  const event = d.topEvent || fallback.topEvent;
  const regions = (d.regions || fallback.regions).slice(0,3).map((r,i)=>`${i+1}. ${r.name} ${Math.round(r.score)}`).join('\n');
  return `ORACLE | World Risk Intelligence\n\nGlobal Risk Index: ${d.score} ${d.state}\n\nTop Event\n${event.title}\n${event.summary}\n\nHot Regions\n${regions}\n\nAI Assessment\n${d.assessment}\n\nContinuously updated.\nhttps://oracle-rho-flax.vercel.app\n\n#ORACLE #WorldRisk #Geopolitics #GlobalRisk #AI`; 
}
function setup(){
  const params = new URLSearchParams(location.search);
  if(params.get('admin') === 'doom') $('adminPanel')?.classList.add('open');
  $('whyBtn').addEventListener('click', ()=> $('scoreModal').classList.add('open'));
  $('closeModal').addEventListener('click', ()=> $('scoreModal').classList.remove('open'));
  $('scoreModal').addEventListener('click', (e)=>{ if(e.target.id === 'scoreModal') $('scoreModal').classList.remove('open'); });
  document.addEventListener('keydown', e=>{ if(e.key === 'Escape') $('scoreModal').classList.remove('open'); });
  $('refreshBtn')?.addEventListener('click', loadRisk);
  $('makePostBtn')?.addEventListener('click', ()=> $('postText').value = generatePost());
  $('copyPostBtn')?.addEventListener('click', async ()=>{ await navigator.clipboard.writeText($('postText').value || generatePost()); });
  loadRisk();
  setInterval(loadRisk, 60000);
}
setup();
