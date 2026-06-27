/* ====================================================================
   CASHFLOW v6 — движок реалистичной игры
   Время/внимание · возраст · инфляция · экспертиза · риск · налоги · биржа
   Чистый JS, без зависимостей. Сохранение в localStorage.
   ==================================================================== */
'use strict';

const SAVE_KEY = 'cashflow_save_v6';
const LOAN_RATE = 0.03;   // платёж по банковскому кредиту = 3% долга/мес (~36% годовых)

let S = null;
let busy = false;

/* ----------------------- Утилиты ----------------------- */
const $ = (s) => document.querySelector(s);
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function fmt(n){
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}
function fmtShort(n){
  const a = Math.abs(n);
  if(a >= 1e6) return (n/1e6).toFixed(a>=1e7?0:1).replace('.',',') + ' млн';
  if(a >= 1e3) return Math.round(n/1e3) + ' тыс';
  return Math.round(n) + '';
}
function fmtSigned(n){ return (n >= 0 ? '+' : '') + fmt(n); }

/* ----------------------- Время / возраст ----------------------- */
function curMonthIdx(){ return (CONFIG.startMonth + S.month) % 12; }
function curYear(){ return CONFIG.startYear + Math.floor((CONFIG.startMonth + S.month) / 12); }
function curAge(){ return S.age + Math.floor((CONFIG.startMonth + S.month) - CONFIG.startMonth >= 0 ? S.month/12 : 0); }
function dateLabel(){ return MONTHS_RU[curMonthIdx()] + ' ' + curYear(); }

/* ----------------------- Экспертиза / налоги ----------------------- */
const EXP_FACTORS = [1.6, 1.0, 0.7, 0.45];           // 0..3 → множитель риска
function expLevel(domain){ return (S.expertise && S.expertise[domain]) || 0; }
function expFactor(domain){ return EXP_FACTORS[clamp(expLevel(domain),0,3)]; }
function expLabel(domain){ return ['нет','базовая','хорошая','эксперт'][clamp(expLevel(domain),0,3)]; }
function taxOf(a){
  if(a.cls === 'security') return CONFIG.tax.dividend;
  if(a.cls === 'realestate') return CONFIG.tax.rent;
  return CONFIG.tax.business;
}

/* ----------------------- Время / внимание ----------------------- */
function jobHours(j){ return j.quit ? 0 : (j.delegated && j.delegate ? j.delegate.hours : j.hours); }
function jobIncome(j){ return j.quit ? 0 : (j.delegated && j.delegate ? j.delegate.income : j.income); }
function committedHours(){
  let h = 0;
  for(const j of S.jobs) h += jobHours(j);
  for(const a of S.assets) h += a.hours || 0;
  return h;
}
function freeHours(){ return CONFIG.timeCapacity - committedHours(); }
function overload(){ return Math.max(0, committedHours() - CONFIG.timeCapacity); }
function overloadPenalty(){
  return clamp(1 - CONFIG.overloadSoftPenaltyPer10h * (overload()/10), 0.5, 1);
}

/* ----------------------- Финансовые расчёты ----------------------- */
const PASSIVE_HOURS_THRESHOLD = 4;   // актив ≤ 4 ч/мес = настоящий пассив; больше = активный

function activeIncomeNet(){
  let s = 0;
  for(const j of S.jobs) s += jobIncome(j);
  // бизнесы/активы, требующие ТВОЕГО времени (> порога) = активный доход, не пассив
  for(const a of S.assets){
    if((a.hours||0) > PASSIVE_HOURS_THRESHOLD) s += assetMonthlyNet(a);
  }
  return Math.round(s * overloadPenalty());
}
function assetMonthlyNet(a){
  return Math.round(a.annualIncome * (a.health == null ? 1 : a.health) / 12 * (1 - taxOf(a)));
}
function securitiesDivMonthlyNet(){
  let s = 0;
  const dm = (S && S.divMult) || 1;
  for(const sym in (S.holdings||{})){
    const def = SECURITIES.find(x => x.sym === sym);
    const h = S.holdings[sym];
    if(def && h && h.shares > 0) s += def.dividend * dm * h.shares;
  }
  return Math.round(s / 12 * (1 - CONFIG.tax.dividend));
}
function passiveNetMonthly(){
  // ТОЛЬКО активы, не требующие твоего времени (≤ порога) + дивиденды/купоны
  let s = 0;
  for(const a of S.assets){
    if((a.hours||0) <= PASSIVE_HOURS_THRESHOLD) s += assetMonthlyNet(a);
  }
  s += securitiesDivMonthlyNet();
  return s;
}
function activeAssetIncome(){
  // бизнесы, съедающие время — это работа, не свобода
  let s = 0;
  for(const a of S.assets){
    if((a.hours||0) > PASSIVE_HOURS_THRESHOLD) s += assetMonthlyNet(a);
  }
  return s;
}
function securitiesValue(){
  let v = 0;
  for(const sym in (S.holdings||{})){
    const h = S.holdings[sym];
    if(h && h.shares > 0) v += h.shares * (S.prices[sym] || 0);
  }
  return v;
}
function expensesMonthly(){
  let s = 0;
  for(const k in S.expenses) s += S.expenses[k];
  s = s * S.inflationMult;
  for(const k in S.liabilities) s += S.liabilities[k].payment;
  return Math.round(s);
}
function cashflowMonthly(){ return activeIncomeNet() + passiveNetMonthly() - expensesMonthly(); }
function isFree(){ return passiveNetMonthly() >= expensesMonthly(); }
function netWorth(){
  let assets = S.cash + securitiesValue();
  for(const a of S.assets) assets += (a.cost || 0);
  let debt = 0;
  for(const k in S.liabilities) debt += S.liabilities[k].balance;
  for(const a of S.assets) debt += (a.debt || 0);
  return assets - debt;
}

/* ----------------------- Журнал ----------------------- */
function log(msg, cls){
  S.log.unshift({ msg, cls: cls || '', m: dateLabel() });
  if(S.log.length > 80) S.log.pop();
  renderLog();
}
function renderLog(){
  $('#log').innerHTML = S.log.map(e =>
    `<div class="log-entry ${e.cls}"><span style="color:var(--text-mut);font-size:11px">${e.m}</span> ${e.msg}</div>`
  ).join('');
}

/* ====================================================================
   ДОСКА (SVG) — 7×7 кольцо = 24 клетки
   ==================================================================== */
const ICONS = { deal:'💼', market:'📈', life:'🎲', doodad:'🛒' };
let CELL_POS = [];
function buildBoardPositions(){
  CELL_POS = [];
  const N = 7, margin = 14, area = 560 - margin*2, step = area / N, cw = step - 6;
  const grid = [];
  for(let c=0;c<N;c++) grid.push([c,0]);
  for(let r=1;r<N;r++) grid.push([N-1,r]);
  for(let c=N-2;c>=0;c--) grid.push([c,N-1]);
  for(let r=N-2;r>=1;r--) grid.push([0,r]);
  for(const [c,r] of grid){
    const x = margin + c*step + 3, y = margin + r*step + 3;
    CELL_POS.push({ x, y, w:cw, h:cw, cx:x+cw/2, cy:y+cw/2 });
  }
}
function renderBoard(){
  const svg = $('#board');
  let html = '';
  for(let i=0;i<BOARD.length;i++){
    const cell = BOARD[i], p = CELL_POS[i];
    html += `<rect class="cell-rect cell-${cell.type}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="7"/>`;
    html += `<text class="cell-icon" x="${p.cx}" y="${p.cy-2}" text-anchor="middle" dominant-baseline="middle">${ICONS[cell.type]}</text>`;
    html += `<text class="cell-label" x="${p.cx}" y="${p.y+p.h-7}" text-anchor="middle">${cell.label}</text>`;
  }
  html += `<text x="280" y="258" text-anchor="middle" style="fill:var(--text);font-size:15px;font-weight:700">${dateLabel()}</text>`;
  html += `<text x="280" y="282" text-anchor="middle" style="fill:var(--text-mut);font-size:12px">возраст ${curAge()}</text>`;
  html += `<text x="280" y="306" text-anchor="middle" style="fill:var(--accent);font-size:11px">месяц ${S.month+1}</text>`;
  const p0 = CELL_POS[S.position];
  html += `<circle class="token" id="token" cx="${p0.cx}" cy="${p0.cy}" r="11"/>`;
  svg.innerHTML = html;
}
function moveToken(idx){
  const p = CELL_POS[idx], t = $('#token');
  if(t){ t.setAttribute('cx', p.cx); t.setAttribute('cy', p.cy); }
}

/* ====================================================================
   РЕНДЕР
   ==================================================================== */
function render(){
  const act = activeIncomeNet(), pas = passiveNetMonthly(), exp = expensesMonthly(), cf = act + pas - exp;

  $('#m-income').textContent  = fmt(act + pas);
  $('#m-expense').textContent = fmt(exp);
  $('#m-passive').textContent = fmt(pas);
  const cfEl = $('#m-cashflow'); cfEl.textContent = fmtSigned(cf);
  cfEl.className = 'm-val ' + (cf >= 0 ? 'pos' : 'neg');
  $('#m-cash').textContent = fmt(S.cash);
  $('#m-networth').textContent = fmt(netWorth());

  // цель: фазовый прогресс по брифу
  const goalNum = $('#goal-num'), goalSub = $('#goal-sub'), goalBar = $('#goal-bar');
  const kavelt = S.jobs.find(j => j.id === 'kavelt' && !j.quit);
  const kaveltInc = kavelt ? jobIncome(kavelt) : 0;
  const kael = S.jobs.find(j => j.id === 'kael' && !j.quit);
  const rise = S.jobs.find(j => j.id === 'rise' && !j.quit);
  const portf = securitiesValue();

  if(!kavelt && (kael || rise)){
    goalNum.textContent = 'ЗАПУСТИ КАВЕЛТ'; goalNum.classList.remove('win');
    goalSub.textContent = 'переведи свободные часы в свою маржу';
    goalBar.style.width = '0%';
  } else if(kael && kaveltInc < jobIncome(kael)){
    const pct = clamp(kaveltInc / jobIncome(kael) * 100, 0, 100);
    goalNum.textContent = `${fmt(jobIncome(kael) - kaveltInc)} до сброса КАЭЛ`; goalNum.classList.remove('win');
    goalSub.textContent = `КАВЕЛТ ${fmt(kaveltInc)} → порог ${fmt(jobIncome(kael))}`;
    goalBar.style.width = pct + '%';
  } else if(kael && kaveltInc >= jobIncome(kael)){
    goalNum.textContent = 'СБРОСЬ КАЭЛ!'; goalNum.classList.add('win');
    goalSub.textContent = `КАВЕЛТ ${fmt(kaveltInc)} >= КАЭЛ ${fmt(jobIncome(kael))} · жми «Работы»`;
    goalBar.style.width = '100%';
  } else if(rise && kaveltInc < jobIncome(rise)){
    const pct = clamp(kaveltInc / jobIncome(rise) * 100, 0, 100);
    goalNum.textContent = `${fmt(jobIncome(rise) - kaveltInc)} до сброса Райза`; goalNum.classList.remove('win');
    goalSub.textContent = `КАВЕЛТ ${fmt(kaveltInc)} → порог ${fmt(jobIncome(rise))}`;
    goalBar.style.width = pct + '%';
  } else if(rise && kaveltInc >= jobIncome(rise)){
    goalNum.textContent = 'СДАВАЙ РАЙЗ!'; goalNum.classList.add('win');
    goalSub.textContent = `КАВЕЛТ ${fmt(kaveltInc)} >= Райз ${fmt(jobIncome(rise))} · ВЫХОД ИЗ БЕГОВ`;
    goalBar.style.width = '100%';
  } else if(!rise && !kael && portf < 108e6){
    const pct = clamp(portf / 108e6 * 100, 0, 100);
    goalNum.textContent = fmt(108e6 - portf) + ' до цели'; goalNum.classList.remove('win');
    goalSub.textContent = `портфель ${fmt(portf)} из 108 млн`;
    goalBar.style.width = pct + '%';
  } else if(portf >= 108e6){
    goalNum.textContent = 'МЕЧТА!'; goalNum.classList.add('win');
    goalSub.textContent = `портфель ${fmt(portf)} — квартира, BMW, свобода`;
    goalBar.style.width = '100%';
  } else {
    const gap = exp - pas;
    if(gap <= 0){ goalNum.textContent = 'НА СВОЕЙ МАРЖЕ'; goalNum.classList.add('win'); goalSub.textContent = 'оклады сброшены, растим портфель'; }
    else { goalNum.textContent = fmt(gap); goalNum.classList.remove('win'); goalSub.textContent = `пассив ${fmt(pas)} из ${fmt(exp)}`; }
    goalBar.style.width = clamp(exp>0?pas/exp*100:0,0,100) + '%';
  }

  // время / внимание
  renderTime();
  // календарь
  $('#hud-date').textContent = dateLabel();
  $('#hud-age').textContent = 'возраст ' + curAge();
  $('#hud-infl').textContent = 'инфляция +' + Math.round((S.inflationMult-1)*100) + '%';

  $('#player-line').textContent = `${S.name}`;

  // советник
  const adv = $('#advisor'); if(adv) adv.innerHTML = advisorTip(act, pas, exp, cf);

  renderStatement(act, pas, exp);
  renderBoard();
  renderLog();
  $('#btn-roll').disabled = busy;
  $('#btn-broker').disabled = busy;
  $('#btn-jobs').disabled = busy;
  save();
}

function renderTime(){
  const cap = CONFIG.timeCapacity, used = committedHours(), free = cap - used, ov = overload();
  const bar = $('#time-bar'), txt = $('#time-text');
  const pctUsed = clamp(used/cap*100, 0, 100);
  bar.style.width = pctUsed + '%';
  bar.className = 'time-fill' + (ov>0 ? ' over' : (free<30 ? ' tight' : ''));
  if(ov > 0) txt.innerHTML = `<b class="neg">Перегрузка ${ov} ч/мес</b> · занято ${used} из ${cap} ч · доход −${Math.round((1-overloadPenalty())*100)}%`;
  else txt.innerHTML = `Свободно <b>${free} ч/мес</b> · занято ${used} из ${cap} ч`;
}

function renderStatement(act, pas, exp){
  let h = '';
  // — АКТИВНЫЙ доход: работы + бизнесы, съедающие время —
  h += `<div class="stmt-head" style="border:0;padding:0;margin-bottom:4px;color:var(--text-dim)"><span>Активный доход (требует времени)</span></div>`;
  for(const j of S.jobs){
    const inc = jobIncome(j);
    const tag = j.quit ? '<span class="asset-tag">уволен</span>' : (j.delegated ? '<span class="asset-tag">делегировано</span>' : `<span class="asset-tag">${j.kind} · ${jobHours(j)} ч/мес</span>`);
    h += `<div class="stmt-row"><span class="lbl">${j.name} ${tag}</span><span class="num">${fmt(inc)}</span></div>`;
  }
  // бизнесы-активы, съедающие время (> порога)
  for(const a of S.assets){
    if((a.hours||0) > PASSIVE_HOURS_THRESHOLD){
      const net = assetMonthlyNet(a);
      const invested = a.cost || 1;
      const yieldPct = invested > 0 ? Math.round(a.annualIncome*(a.health||1)/invested*100) : 0;
      h += `<div class="stmt-row manageable" data-aid="${a.id}"><span class="lbl">${a.title} <span class="asset-tag">бизнес · ${a.hours} ч · ${yieldPct}% год.</span></span><span class="num">${fmt(net)}</span></div>`;
    }
  }
  if(overloadPenalty() < 1)
    h += `<div class="stmt-row"><span class="lbl neg">Штраф за перегруз</span><span class="num neg">−${Math.round((1-overloadPenalty())*100)}%</span></div>`;
  h += `<div class="stmt-total"><span>Активный итого</span><span>${fmt(act)}</span></div>`;

  // — ПАССИВНЫЙ доход: не требует времени —
  h += `<div class="stmt-head" style="border:0;padding:0;margin:8px 0 4px;color:var(--green)"><span>Пассивный доход (без твоего времени)</span></div>`;
  let pasRows = 0;
  for(const a of S.assets){
    if((a.hours||0) <= PASSIVE_HOURS_THRESHOLD){
      const net = assetMonthlyNet(a);
      const invested = a.cost || 1;
      const yieldPct = (invested > 0 && a.annualIncome > 0) ? Math.round(a.annualIncome*(a.health||1)/invested*100) : 0;
      const pays = { monthly:'ежемес', quarterly:'кв', semiannual:'п/г', annual:'год' }[a.payout] || '';
      const pctTag = yieldPct > 0 ? ` · ${yieldPct}% год.` : '';
      h += `<div class="stmt-row manageable" data-aid="${a.id}"><span class="lbl">${a.title} <span class="asset-tag">${a.hours||0} ч · ${pays}${pctTag}</span></span><span class="num pos">${fmtSigned(net)}</span></div>`;
      pasRows++;
    }
  }
  // дивиденды/купоны от бумаг
  const divTotal = securitiesDivMonthlyNet();
  if(divTotal > 0){ h += `<div class="stmt-row"><span class="lbl">Дивиденды / купоны (среднее)</span><span class="num pos">${fmtSigned(divTotal)}</span></div>`; pasRows++; }
  if(pasRows === 0) h += `<div class="stmt-row"><span class="lbl" style="font-style:italic;color:var(--text-mut)">нет пассивного дохода</span></div>`;
  h += `<div class="stmt-total pos"><span>Пассивный итого</span><span>${fmt(pas)}</span></div>`;
  $('#stmt-income').innerHTML = h;

  // Расходы
  h = '';
  for(const k in S.expenses)
    h += `<div class="stmt-row"><span class="lbl">${k}</span><span class="num">${fmt(Math.round(S.expenses[k]*S.inflationMult))}</span></div>`;
  for(const k in S.liabilities){
    if(S.liabilities[k].payment > 0){
      const ratePct = S.liabilities[k].balance > 0 ? Math.round(S.liabilities[k].payment/S.liabilities[k].balance*12*100) : 0;
      h += `<div class="stmt-row"><span class="lbl">${k} <span class="asset-tag">${ratePct}% год.</span></span><span class="num">${fmt(S.liabilities[k].payment)}</span></div>`;
    }
  }
  h += `<div class="stmt-total"><span>Расходы / мес</span><span>${fmt(exp)}</span></div>`;
  $('#stmt-expense').innerHTML = h;

  // Активы (портфель бумаг + все активы с балансовой стоимостью для netWorth)
  const rows = [];
  // бумаги
  for(const sym in (S.holdings||{})){
    const hd = S.holdings[sym]; if(!hd || hd.shares<=0) continue;
    const def = SECURITIES.find(x=>x.sym===sym);
    const val = hd.shares * (S.prices[sym]||0);
    const dm = S.divMult || 1;
    const divM = def.dividend>0 ? Math.round(def.dividend*dm*hd.shares/12*(1-0.13)) : 0;
    const divYieldPct = def.dividend>0 ? Math.round(def.dividend*dm/(S.prices[sym]||def.price)*100) : 0;
    const yieldTag = divYieldPct > 0 ? ` · ${divYieldPct}% год.` : ' · без див.';
    rows.push(`<div class="stmt-row"><span class="lbl">${def.name} <span class="asset-tag">${hd.shares} шт · ${fmt(S.prices[sym]||0)}${yieldTag}</span></span>
      <span class="num">${fmt(val)}${divM?` <span class="pos" style="font-size:11px">${fmtSigned(divM)}</span>`:''}</span></div>`);
  }
  $('#stmt-assets').innerHTML = rows.length ? rows.join('') : `<div class="stmt-row"><span class="lbl" style="font-style:italic;color:var(--text-mut)">пока нет активов</span></div>`;

  // Пассивы
  h = '';
  const liabKeys = Object.keys(S.liabilities);
  if(liabKeys.length===0 && !S.assets.some(a=>a.debt>0)){
    h = `<div class="stmt-row"><span class="lbl" style="font-style:italic;color:var(--text-mut)">долгов нет</span></div>`;
  }else{
    for(const k in S.liabilities){
      const L = S.liabilities[k];
      const ratePct = L.balance > 0 && L.payment > 0 ? Math.round(L.payment/L.balance*12*100) : 0;
      const rateTag = ratePct > 0 ? ` <span class="asset-tag">${ratePct}% год. · ${fmt(L.payment)}/мес</span>` : '';
      h += `<div class="stmt-row manageable" data-liab="${k}"><span class="lbl">${k}${rateTag}</span><span class="num neg">${fmt(L.balance)}</span></div>`;
    }
    for(const a of S.assets) if(a.debt>0)
      h += `<div class="stmt-row"><span class="lbl">Ипотека: ${a.title}</span><span class="num neg">${fmt(a.debt)}</span></div>`;
  }
  $('#stmt-liab').innerHTML = h;
}

/* ====================================================================
   МОДАЛКИ
   ==================================================================== */
function openCard(html){ $('#card-modal').className='modal'; $('#card-modal').innerHTML = html; $('#card-overlay').classList.add('show'); }
function closeCard(){ $('#card-overlay').classList.remove('show'); }
function dealStat(l,v,c){ return `<div class="deal-stat"><div class="ds-l">${l}</div><div class="ds-v ${c||''}">${v}</div></div>`; }
function simpleModal(bc,bt,t,d,bn){
  return `<div class="modal-head"><span class="deck-badge ${bc}">${bt}</span><h3>${t}</h3></div>
    <div class="modal-body"><p class="deal-desc">${d}</p></div>
    <div class="modal-foot"><button class="btn primary" id="m-ok">${bn}</button></div>`;
}

/* индикатор доходности + времени + экспертизы */
function dealVerdict(deal){
  const invested = deal.cls==='realestate' ? deal.down : deal.cost;
  const annual = deal.annualIncome;
  let h = '';
  if(annual <= 0){
    h += `<div class="yield-badge trap">⚠ Поток минусовой - это пассив, а не актив. Будешь доплачивать из зарплаты.</div>`;
  }else if(invested>0){
    const y = Math.round(annual/invested*100);
    let cls = y>=25?'great':y>=12?'good':'weak';
    const verdict = y>=25?'Отличный поток':y>=12?'Хороший актив':'Слабая доходность';
    h += `<div class="yield-badge ${cls}">Доходность ≈ <b>${y}%</b> годовых · ${verdict}</div>`;
  }
  // время
  if(deal.hours > 0)
    h += `<div class="yield-badge weak">⏳ Требует <b>${deal.hours} ч/мес</b> твоего времени${deal.manager?' (можно нанять управляющего)':''}. Это работа, не пассив.</div>`;
  else
    h += `<div class="yield-badge good">⏳ Времени почти не требует - настоящий пассив.</div>`;
  // экспертиза/риск
  if(deal.domain && deal.domain!=='биржа'){
    const lvl = expLevel(deal.domain), f = expFactor(deal.domain);
    const effRisk = Math.round((deal.risk||0)*f*100);
    let rcls = effRisk>=20?'trap':effRisk>=12?'weak':'good';
    h += `<div class="yield-badge ${rcls}">🎯 Твоя экспертиза в «${DOMAINS[deal.domain]}»: <b>${expLabel(deal.domain)}</b>. Риск для тебя ≈ ${effRisk}%/год.${lvl<=0?' Это не твоё поле - легко прогореть.':''}</div>`;
  }
  return h;
}

/* ====================================================================
   СОХРАНЕНИЕ
   ==================================================================== */
function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){} }
function loadSave(){ try{ const r=localStorage.getItem(SAVE_KEY); return r?JSON.parse(r):null; }catch(e){ return null; } }
function clearSave(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }

/* ====================================================================
   СТАРТ
   ==================================================================== */
let selectedProf = null;

function renderProfGrid(){
  const grid = $('#prof-grid');
  grid.innerHTML = ALL_PROFILES.map(p => {
    let liab=0; for(const k in p.liabilities) liab += p.liabilities[k].payment;
    let consumption=0; for(const k in p.expenses) consumption += p.expenses[k];
    const exp = consumption + liab;
    let active=0, hrs=0; for(const j of p.jobs){ active += j.income; hrs += j.hours; }
    let pas=0; (p.startAssets||[]).forEach(a => pas += Math.round(a.annualIncome/12));
    const cf = active + pas - exp;
    const featured = p.real ? ' featured' : '';
    return `<button class="prof-card${featured}" data-id="${p.id}">
      <div class="pc-name">${p.real?'★ ':''}${p.name}</div>
      <div class="pc-line"><span>Активный доход</span><span class="num">${fmt(active)}</span></div>
      ${pas>0?`<div class="pc-line"><span>Пассивный</span><span class="num pc-cf">${fmt(pas)}</span></div>`:''}
      <div class="pc-line"><span>Расходы</span><span class="num">${fmt(exp)}</span></div>
      <div class="pc-line"><span>Занятость</span><span class="num">${hrs} ч/мес</span></div>
      <div class="pc-line"><span>Возраст · нал.</span><span class="num">${p.age} · ${fmtShort(p.cash)}</span></div>
    </button>`;
  }).join('');
  grid.querySelectorAll('.prof-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.prof-card').forEach(c => c.classList.remove('sel'));
      card.classList.add('sel');
      selectedProf = card.dataset.id;
      $('#start-note').textContent = 'Выбрано: ' + ALL_PROFILES.find(p=>p.id===selectedProf).name;
      $('#btn-start').disabled = false;
    });
  });
}

function startGame(profId){
  const p = ALL_PROFILES.find(x => x.id === profId);
  const prices = {}; SECURITIES.forEach(s => prices[s.sym] = s.price);
  S = {
    prof: p.id, name: p.name, real: !!p.real,
    age: p.age, month: 0, cash: p.cash,
    expertise: JSON.parse(JSON.stringify(p.expertise)),
    jobs: JSON.parse(JSON.stringify(p.jobs)),
    expenses: JSON.parse(JSON.stringify(p.expenses)),
    liabilities: JSON.parse(JSON.stringify(p.liabilities)),
    assets: (p.startAssets||[]).map((a,i)=>Object.assign({health:1}, a, {id:'seed'+i})),
    holdings: {}, prices,
    inflationMult: 1,
    position: 0, turn: 1,
    won: false, log: [],
  };
  $('#start-overlay').classList.remove('show');
  $('#game-view').style.display = 'grid';
  if(p.real){
    log(`Старт от себя, ${dateLabel()}, ${curAge()} лет. Три потока съедают почти всё время: свободно ${freeHours()} ч/мес. Чтобы заняться активами - освободи время.`, 'gold');
  } else {
    log(`Старт: ${p.name}, ${curAge()} лет. Цель - пассивный доход ≥ расходов.`, 'gold');
  }
  render();
}

/* ====================================================================
   ХОД = МЕСЯЦ
   ==================================================================== */
function onRollClick(){
  if(busy) return;
  doRoll();
}
function doRoll(){
  busy = true; render();
  const dice = $('#dice'); dice.classList.add('rolling');
  $('#turn-hint').textContent = 'Идёт месяц...';
  const steps = 1 + rnd(6);
  setTimeout(() => {
    dice.classList.remove('rolling');
    dice.textContent = ['','⚀','⚁','⚂','⚃','⚄','⚅'][steps];
    animateMove(steps);
  }, 450);
}
function animateMove(steps){
  let moved = 0; const N = BOARD.length;
  const step = () => {
    if(moved >= steps){ arrive(); return; }
    S.position = (S.position + 1) % N; moved++;
    moveToken(S.position);
    setTimeout(step, 150);
  };
  setTimeout(step, 150);
}
function arrive(){
  const cell = BOARD[S.position];
  handleCell(cell);
}
function handleCell(cell){
  switch(cell.type){
    case 'deal':   cellDeal(); break;
    case 'market': cellMarket(); break;
    case 'life':   cellLife(); break;
    case 'doodad': cellDoodad(); break;
    default:       endTurn();
  }
}

/* конец хода: расчёт месяца (доходы/расходы/выплаты/инфляция/возраст/риск) */
function endTurn(){
  settleMonth();
  busy = false;
  $('#turn-hint').textContent = 'Ваш ход. Бросьте кубик (= следующий месяц).';
  render();
  checkWin();
}

function settleMonth(){
  const m = curMonthIdx();
  let delta = 0;
  // активный доход
  delta += activeIncomeNet();
  // выплаты по активам (с учётом простоя недвижимости)
  for(const a of S.assets){
    const due = assetPayoutThisMonth(a, m);
    delta += due;
  }
  // дивиденды по бумагам
  delta += securitiesPayoutThisMonth(m);
  // расходы
  delta -= expensesMonthly();
  S.cash += Math.round(delta);

  // рост КАВЕЛТ (чем больше часов вложено, тем быстрее растёт спрос → маржа)
  kaveltGrowthTick();
  // дрейф цен бумаг (с положительным трендом ≈ инфляция + реальный рост)
  driftPrices();
  // инфляция расходов
  S.inflationMult *= (1 + CONFIG.monthlyInflation);
  // время идёт
  S.month++; S.turn++;
  // раз в год: индексация доходов, обзор бизнеса, выгорание
  if(S.month % 12 === 0) yearlyReview();
  burnoutTick();
  marketCrashTick();
}

function assetPayoutThisMonth(a, m){
  const incNetAnnual = a.annualIncome * (a.health==null?1:a.health) * (1 - taxOf(a));
  if(a.annualIncome <= 0){ // минусовой поток (ловушка) - списываем равномерно
    return Math.round(a.annualIncome/12 * (a.health==null?1:a.health));
  }
  if(a.cls === 'realestate'){
    // помесячно, но возможен простой
    if(Math.random() < (a.vacancy||0)){
      if(Math.random()<0.5) log(`Простой аренды: «${a.title}» в этом месяце пустует.`, 'bad');
      return 0;
    }
    return Math.round(incNetAnnual/12);
  }
  // бизнес/бумага-актив по расписанию
  const map = { monthly:[0,1,2,3,4,5,6,7,8,9,10,11], quarterly:[2,5,8,11], semiannual:[5,11], annual:[11] };
  const months = a.payMonths || map[a.payout] || map.monthly;
  if(months.indexOf(m) === -1) return 0;
  return Math.round(incNetAnnual / months.length);
}
function securitiesPayoutThisMonth(m){
  let s = 0;
  const dm = S.divMult || 1;   // множитель роста дивидендов (индексация с инфляцией)
  for(const sym in (S.holdings||{})){
    const def = SECURITIES.find(x=>x.sym===sym); const hd = S.holdings[sym];
    if(!def || !hd || hd.shares<=0 || !def.dividend) continue;
    const months = def.payMonths === 'all' ? [0,1,2,3,4,5,6,7,8,9,10,11] : (def.payMonths||[]);
    if(months.indexOf(m) === -1) continue;
    const pay = def.dividend * dm * hd.shares / months.length * (1 - CONFIG.tax.dividend);
    s += pay;
    if(pay > 0) log(`Выплата по «${def.name}»: ${fmtSigned(Math.round(pay))}.`, 'good');
  }
  return Math.round(s);
}
function driftPrices(){
  // Акции/фонды долгосрочно растут: инфляция (~0.6%/мес) + реальный рост (~0.3%/мес) = ~0.9%/мес тренд.
  // Облигации и золото — свой тренд. Поверх — случайная волатильность.
  for(const def of SECURITIES){
    const v = def.vol || 0.1;
    const isStock = def.kind === 'акция' || def.kind === 'акция роста' || def.kind === 'фонд';
    const isBond = def.kind === 'облигация';
    const trend = isStock ? 0.009 : (isBond ? 0.001 : 0.005);  // месячный восходящий тренд
    const noise = (Math.random() - 0.5) * v * 0.5;
    S.prices[def.sym] = Math.max(def.price * 0.2, Math.round((S.prices[def.sym] || def.price) * (1 + trend + noise)));
  }
}

function yearlyReview(){
  // 1) ИНДЕКСАЦИЯ ДОХОДОВ (раз в год, как в жизни)
  const yearInfl = Math.pow(1 + CONFIG.monthlyInflation, 12) - 1;  // ~8%
  const salaryIndex = 1 + yearInfl * 0.7;       // зарплату индексируют на ~70% инфляции (с отставанием)
  const divIndex    = 1 + yearInfl * 0.85;       // дивиденды растут ~85% инфляции (компании поднимают цены)
  const rentIndex   = 1 + yearInfl * 0.6;        // аренда отстаёт от инфляции (рынок давит)
  const bizIndex    = 1 + yearInfl * 0.9;        // бизнес-доход хорошо растёт с ценами

  // зарплаты
  for(const j of S.jobs){
    if(!j.quit){
      j.income = Math.round(j.income * salaryIndex);
      if(j.delegate) j.delegate.income = Math.round(j.delegate.income * salaryIndex);
    }
  }
  // дивиденды по бумагам (растут в определениях — пересчитываем на S)
  if(!S.divMult) S.divMult = 1;
  S.divMult *= divIndex;
  // доходы активов
  for(const a of S.assets){
    if(a.annualIncome <= 0) continue;  // ловушки не «лечатся» инфляцией
    if(a.cls === 'realestate') a.annualIncome = Math.round(a.annualIncome * rentIndex);
    else if(a.cls === 'business') a.annualIncome = Math.round(a.annualIncome * bizIndex);
  }

  log(`Годовой обзор: зарплаты +${Math.round((salaryIndex-1)*100)}%, аренда +${Math.round((rentIndex-1)*100)}%, бизнес +${Math.round((bizIndex-1)*100)}%, инфляция +${Math.round(yearInfl*100)}%.`, 'info');

  // 2) РИСК-ОБЗОР бизнесов
  for(const a of S.assets){
    if(a.cls !== 'business' || a.real) continue;
    const effRisk = (a.risk||0) * expFactor(a.domain);
    if(Math.random() < effRisk){
      if(Math.random() < 0.15){
        log(`💥 Бизнес «${a.title}» прогорел - актив потерян.`, 'bad');
        a._dead = true;
      } else {
        a.health = Math.max(0.4, (a.health||1) - 0.3);
        log(`Тяжёлый год у «${a.title}»: доход просел (здоровье ${Math.round(a.health*100)}%).`, 'bad');
      }
    } else if((a.health||1) < 1){
      a.health = Math.min(1, (a.health||1) + 0.2);
    }
  }
  S.assets = S.assets.filter(a => !a._dead);
}
function kaveltGrowthTick(){
  const kv = S.jobs.find(j => j.id === 'kavelt' && !j.quit);
  if(!kv) return;
  // рост пропорционален вложенным часам + немного случайности (спрос - не гарантия)
  // базовый рост: ~15-25к/мес за каждые 30ч вложенных, с разбросом
  const hoursInvested = kv.hours || 30;
  const baseGrowth = Math.round(hoursInvested * (500 + rnd(400))); // 500-900 руб/час вложенный
  const luck = Math.random();
  if(luck < 0.08){
    // плохой месяц: клиент ушёл / не заплатил
    const loss = Math.min(kv.income, 30000 + rnd(40000));
    kv.income = Math.max(0, kv.income - loss);
    if(loss > 0) log(`КАВЕЛТ: клиент ушёл, маржа просела на ${fmt(loss)}.`, 'bad');
  } else if(luck < 0.15){
    // отличный месяц: крупный заказ
    kv.income += baseGrowth * 3;
    log(`КАВЕЛТ: крупный заказ! Маржа выросла до ${fmt(kv.income)}/мес.`, 'gold');
  } else {
    // обычный рост
    kv.income += baseGrowth;
  }
  // потолок масштабирования зависит от часов (больше часов → больше клиентов → больше маржа)
  // но есть естественный потолок ~25к на час (дорогие B2B-услуги)
  const cap = hoursInvested * 25000;
  kv.income = Math.min(kv.income, cap);
}

function burnoutTick(){
  const ov = overload();
  if(ov > 0 && Math.random() < CONFIG.burnoutEventChancePer10h * (ov/10)){
    const cost = 30000 + rnd(60000);
    S.cash -= cost;
    log(`😮‍💨 Выгорание от перегруза: лечение/срыв сделки -${fmt(cost)}. Освободи время!`, 'bad');
  }
}

function marketCrashTick(){
  // ~1 обвал за 7-10 лет (шанс ~1% в месяц)
  if(Math.random() > 0.01) return;
  const severity = 0.55 + Math.random() * 0.20;   // падение на 25-45%
  for(const def of SECURITIES){
    if(def.kind === 'облигация') { S.prices[def.sym] = Math.round((S.prices[def.sym]||def.price) * (0.90 + Math.random()*0.08)); continue; }
    S.prices[def.sym] = Math.round((S.prices[def.sym]||def.price) * severity);
  }
  log('📉 Обвал на бирже! Акции и фонды резко подешевели. У кого кэш — время покупать дёшево.', 'bad');
}

/* ====================================================================
   КЛЕТКА «СДЕЛКА» — выбор бизнес/недвижимость, затем карточка
   ==================================================================== */
function cellDeal(){
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-big">возможность</span><h3>Подвернулась сделка</h3></div>
    <div class="modal-body">
      <p class="deal-desc">К тебе пришла возможность. Хорошие сделки редки и требуют разбора - смотри на доходность, ВРЕМЯ и свою экспертизу, прежде чем влезать.</p>
      <div class="deal-stats">${dealStat('Бизнес','💼 поток + время')}${dealStat('Недвижимость','🏠 аренда')}</div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="deal-skip">Пропустить месяц</button>
      <button class="btn" id="deal-re">Недвижимость</button>
      <button class="btn primary" id="deal-biz">Бизнес</button>
    </div>`);
  $('#deal-skip').onclick = () => { closeCard(); endTurn(); };
  $('#deal-biz').onclick = () => showDeal(Object.assign({cls:'business'}, pick(BUSINESS_DEALS)));
  $('#deal-re').onclick  = () => showDeal(Object.assign({cls:'realestate'}, pick(REALESTATE_DEALS)));
}

function showDeal(deal){
  const invested = deal.cls==='realestate' ? deal.down : deal.cost;
  const canBuy = S.cash >= invested;
  const shortfall = invested - S.cash;
  const canLoan = !canBuy && shortfall > 0 && creditLimit() >= shortfall;
  const loanAmt = canLoan ? Math.ceil(shortfall/1000)*1000 : 0;
  const loanPay = Math.round(loanAmt * LOAN_RATE);

  const annM = Math.round(deal.annualIncome/12);
  let stats = dealStat(deal.cls==='realestate'?'Взнос/нал':'Вход', fmt(invested));
  if(deal.cls==='realestate' && deal.mortgage>0) stats += dealStat('Ипотека', fmt(deal.mortgage), 'neg');
  stats += dealStat('Поток ~/мес', fmtSigned(annM), annM>=0?'pos':'neg');
  stats += dealStat('Время', (deal.hours||0)+' ч/мес');

  let cashNote = '';
  if(canBuy){
    cashNote = '';
  } else if(canLoan){
    cashNote = `<p class="modal-note" style="color:var(--accent)">Не хватает ${fmt(shortfall)}. Банк одобрит кредит ${fmt(loanAmt)} (платёж +${fmt(loanPay)}/мес). ПДН после: ${Math.round((currentDebtPayments()+loanPay)/monthlyIncomeForCredit()*100)}%.</p>`;
  } else if(shortfall > 0){
    const reason = creditLimit() < shortfall ? `ПДН на пределе (${Math.round(pdn()*100)}%) - банк откажет` : 'не хватает наличных';
    cashNote = `<p class="modal-note" style="color:var(--red)">Не хватает ${fmt(shortfall)}. ${reason}.</p>`;
  }

  const canAct = canBuy || canLoan;

  openCard(`
    <div class="modal-head"><span class="deck-badge ${deal.cls==='realestate'?'badge-market':'badge-big'}">${deal.cls==='realestate'?'недвижимость':'бизнес'}</span><h3>${deal.title}</h3></div>
    <div class="modal-body">
      <p class="deal-sub">${deal.sub||''}</p>
      <div class="deal-stats">${stats}</div>
      ${dealVerdict(deal)}
      <p class="deal-desc">${deal.desc}</p>
      ${cashNote}
      ${freeHours() < (deal.hours||0) && deal.hours>0 ? `<p class="modal-note" style="color:var(--red)">У тебя свободно лишь ${freeHours()} ч/мес, а нужно ${deal.hours}. Возьмёшь - уйдёшь в перегруз${deal.manager?', или наймёшь управляющего':''}.</p>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="d-skip">Отказаться</button>
      ${deal.manager && deal.hours>0 ? `<button class="btn" id="d-mgr" ${canAct?'':'disabled'}>${canLoan&&!canBuy?'Кредит + управляющий':'С управляющим'}</button>` : ''}
      <button class="btn primary" id="d-buy" ${canAct?'':'disabled'}>${canBuy?'Купить сам':(canLoan?`В кредит ${fmt(loanAmt)} и купить`:'Не хватает средств')}</button>
    </div>`);
  $('#d-skip').onclick = () => { closeCard(); log(`Отказ: ${deal.title}.`, ''); endTurn(); };
  $('#d-buy').onclick = () => { if(!canBuy && canLoan) takeBankLoan(loanAmt, false); buyDeal(deal, false); };
  if(deal.manager && deal.hours>0) $('#d-mgr').onclick = () => { if(!canBuy && canLoan) takeBankLoan(loanAmt, false); buyDeal(deal, true); };
}

function buyDeal(deal, withManager){
  const invested = deal.cls==='realestate' ? deal.down : deal.cost;
  if(S.cash < invested) return;
  S.cash -= invested;
  let annualIncome = deal.annualIncome;
  let hours = deal.hours || 0;
  if(withManager && deal.manager){ hours = deal.manager.hours; annualIncome = Math.round(annualIncome * deal.manager.factor); }
  let health = 1;
  // «лимон»: проверка качества бизнеса с учётом экспертизы
  if(deal.cls==='business' && deal.lemon){
    const lemonChance = deal.lemon * expFactor(deal.domain);
    if(Math.random() < lemonChance){
      health = 0.45;
      log(`Сделка «${deal.title}» оказалась «лимоном»: реальный доход вдвое ниже обещанного. ${expLevel(deal.domain)<=1?'В чужом домене такое не разглядеть.':''}`, 'bad');
    }
  }
  const a = {
    id: 'a'+Date.now()+rnd(999),
    title: deal.title, sub: deal.sub, cls: deal.cls, domain: deal.domain,
    cost: deal.cls==='realestate'?deal.cost:deal.cost, debt: deal.mortgage||0,
    annualIncome, payout: deal.cls==='realestate'?'monthly':'monthly',
    hours, vacancy: deal.vacancy||0, risk: deal.risk||0, health,
    managed: !!withManager,
  };
  S.assets.push(a);
  log(`Куплено: <b>${deal.title}</b> за ${fmt(invested)}${withManager?' (с управляющим)':''}. Поток ~${fmtSigned(assetMonthlyNet(a))}/мес, время ${hours} ч/мес.`, 'good');
  closeCard(); endTurn();
}

/* ====================================================================
   КЛЕТКА «РЫНОК» — новость двигает цену бумаги
   ==================================================================== */
function cellMarket(){
  const news = pick(MARKET_NEWS);
  const old = S.prices[news.sym] || SECURITIES.find(s=>s.sym===news.sym).price;
  S.prices[news.sym] = Math.round(old * news.factor);
  const def = SECURITIES.find(s=>s.sym===news.sym);
  const owned = (S.holdings[news.sym]||{}).shares || 0;
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-market">рынок</span><h3>${news.title}</h3></div>
    <div class="modal-body">
      <p class="deal-desc">${news.desc}</p>
      <div class="deal-stats">${dealStat(def.name, fmt(S.prices[news.sym]))}${dealStat('Было', fmt(old))}${dealStat('У тебя', owned?owned+' шт':'—')}</div>
      <p class="modal-note">Торговать можно в любой момент через «Биржу» (кнопка внизу).</p>
    </div>
    <div class="modal-foot">
      <button class="btn" id="mk-broker">Открыть биржу</button>
      <button class="btn primary" id="mk-ok">Дальше</button>
    </div>`);
  $('#mk-ok').onclick = () => { closeCard(); endTurn(); };
  $('#mk-broker').onclick = () => { closeCard(); endTurn(); openBroker(); };
}

/* ====================================================================
   КЛЕТКА «ЖИЗНЬ» — события
   ==================================================================== */
function cellLife(){
  const e = pick(LIFE_EVENTS);
  if(e.kind === 'cash'){
    const amt = e.amount * e.sign;
    openCard(simpleModal(e.sign>0?'badge-small':'badge-doodad', 'жизнь', e.title, e.desc + `<br><br><b>${fmtSigned(amt)}</b>`, e.sign>0?'Забрать':'Оплатить'));
    $('#m-ok').onclick = () => { S.cash += amt; log(`${e.title}: ${fmtSigned(amt)}.`, e.sign>0?'good':'bad'); closeCard(); endTurn(); };
    return;
  }
  if(e.kind === 'health'){
    openCard(simpleModal('badge-doodad','здоровье', e.title, e.desc + `<br><br>Лечение −${fmt(e.amount)}.`, 'Ох'));
    $('#m-ok').onclick = () => { S.cash -= e.amount; log(`${e.title}: −${fmt(e.amount)}.`, 'bad'); closeCard(); endTurn(); };
    return;
  }
  if(e.kind === 'expertise'){
    const can = S.cash >= e.amount;
    openCard(`<div class="modal-head"><span class="deck-badge badge-event">развитие</span><h3>${e.title}</h3></div>
      <div class="modal-body"><p class="deal-desc">${e.desc}</p>
        <div class="deal-stats">${dealStat('Стоимость', fmt(e.amount), 'neg')}${dealStat('Навык', DOMAINS[e.domain])}</div></div>
      <div class="modal-foot"><button class="btn ghost" id="ex-no">Потом</button>
        <button class="btn primary" id="ex-yes" ${can?'':'disabled'}>Пройти курс</button></div>`);
    $('#ex-no').onclick = () => { closeCard(); endTurn(); };
    $('#ex-yes').onclick = () => { S.cash -= e.amount; S.expertise[e.domain] = clamp((S.expertise[e.domain]||0)+1,0,3);
      log(`Прокачал навык «${DOMAINS[e.domain]}» до уровня «${expLabel(e.domain)}».`, 'gold'); closeCard(); endTurn(); };
    return;
  }
  if(e.kind === 'job_offer'){
    openCard(`<div class="modal-head"><span class="deck-badge badge-event">работа</span><h3>${e.title}</h3></div>
      <div class="modal-body"><p class="deal-desc">${e.desc}</p>
        <div class="deal-stats">${dealStat('Доход', fmtSigned(e.income), 'pos')}${dealStat('Время', '+'+e.hours+' ч/мес', 'neg')}</div>
        <p class="modal-note">Свободно сейчас ${freeHours()} ч/мес.</p></div>
      <div class="modal-foot"><button class="btn ghost" id="jo-no">Отказаться</button>
        <button class="btn primary" id="jo-yes">Взять подработку</button></div>`);
    $('#jo-no').onclick = () => { closeCard(); endTurn(); };
    $('#jo-yes').onclick = () => { S.jobs.push({id:'gig'+S.month,name:e.title,income:e.income,hours:e.hours,kind:'подработка',canQuit:true});
      log(`Взял подработку «${e.title}»: +${fmt(e.income)}, +${e.hours} ч/мес.`, ''); closeCard(); endTurn(); };
    return;
  }
  if(e.kind === 'market_crash'){
    for(const def of SECURITIES) S.prices[def.sym] = Math.round((S.prices[def.sym]||def.price) * (0.6 + Math.random()*0.15));
    openCard(simpleModal('badge-doodad','рынок', e.title, e.desc + '<br><br>Все акции и фонды резко подешевели. У кого было плечо - больно; у кого кэш - время покупать.', 'Понятно'));
    $('#m-ok').onclick = () => { log('Обвал на бирже: бумаги подешевели.', 'bad'); closeCard(); endTurn(); };
    return;
  }
  if(e.kind === 'rate_cut'){
    openCard(simpleModal('badge-small','ЦБ', e.title, e.desc, 'Ок'));
    $('#m-ok').onclick = () => { log('ЦБ снизил ставку.', 'info'); closeCard(); endTurn(); };
    return;
  }
  endTurn();
}

/* ====================================================================
   КЛЕТКА «ТРАТЫ»
   ==================================================================== */
function cellDoodad(){
  const card = pick(DOODAD_CARDS);
  const amount = Math.round(card.amount * S.inflationMult);
  const needLoan = S.cash < amount;
  const loanAmt = needLoan ? Math.ceil((amount - S.cash)/1000)*1000 : 0;
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-doodad">траты</span><h3>${card.title}</h3></div>
    <div class="modal-body"><p class="deal-desc">${card.desc}</p>
      <div class="deal-stats">${dealStat('К оплате', fmt(amount), 'neg')}${dealStat('Наличные', fmt(S.cash))}</div>
      ${needLoan?`<p class="modal-note" style="color:var(--red)">Не хватает - кредит ${fmt(loanAmt)} (платёж +${fmt(Math.round(loanAmt*LOAN_RATE))}/мес).</p>`:''}</div>
    <div class="modal-foot"><button class="btn primary" id="dd-pay">${needLoan?'Кредит и оплатить':'Оплатить'}</button></div>`);
  $('#dd-pay').onclick = () => { if(needLoan) takeBankLoan(loanAmt,true); S.cash -= amount; log(`Трата: <b>${card.title}</b> −${fmt(amount)}.`, 'bad'); closeCard(); endTurn(); };
}

/* ====================================================================
   БИРЖА — торговля бумагами в любой момент
   ==================================================================== */
function openBroker(){
  if(busy) return;
  const rows = SECURITIES.map(def => {
    const price = S.prices[def.sym] || def.price;
    const hd = S.holdings[def.sym] || {shares:0};
    const yld = def.dividend>0 ? Math.round(def.dividend/price*100) : 0;
    const pays = { monthly:'ежемес', quarterly:'кв', semiannual:'2/год', annual:'год', none:'—' }[def.payout];
    return `<div class="brk-row">
      <div class="brk-info">
        <div class="brk-name">${def.name} <span class="asset-tag">${def.kind}</span></div>
        <div class="brk-sub">${fmt(price)} · ${yld?('див '+yld+'% '+pays):'без дивидендов'} · риск ${Math.round((def.risk||0)*100)}%</div>
        ${hd.shares>0?`<div class="brk-own">в портфеле: ${hd.shares} шт на ${fmt(hd.shares*price)}</div>`:''}
      </div>
      <div class="brk-act">
        <input type="number" class="brk-qty" data-sym="${def.sym}" value="0" min="0" step="1">
        <button class="btn sm primary brk-buy" data-sym="${def.sym}">Купить</button>
        ${hd.shares>0?`<button class="btn sm brk-sell" data-sym="${def.sym}">Продать</button>`:''}
      </div>
    </div>`;
  }).join('');
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-market">биржа</span><h3>Биржа · наличные ${fmt(S.cash)}</h3></div>
    <div class="modal-body" style="max-height:60vh;overflow-y:auto">
      <p class="modal-note">Покупай и продавай в любой момент, любым объёмом. Дивиденды приходят по расписанию (год/квартал/мес). С дохода - налог 13%.</p>
      ${rows}
    </div>
    <div class="modal-foot"><button class="btn primary" id="brk-close">Закрыть</button></div>`);
  $('#card-modal').classList.add('broker-modal');
  $('#brk-close').onclick = () => closeCard();
  const qty = (sym) => Math.max(0, parseInt($(`.brk-qty[data-sym="${sym}"]`).value)||0);
  $('#card-modal').querySelectorAll('.brk-buy').forEach(b => b.onclick = () => {
    const sym=b.dataset.sym, n=qty(sym), price=S.prices[sym]||0, cost=n*price;
    if(n<=0) return;
    if(cost>S.cash){ log('Не хватает наличных на покупку.', ''); return; }
    S.cash -= cost;
    const hd = S.holdings[sym] || {shares:0, avg:price};
    hd.avg = hd.shares>0 ? Math.round((hd.avg*hd.shares + price*n)/(hd.shares+n)) : price;
    hd.shares += n; S.holdings[sym]=hd;
    log(`Куплено ${n} × ${sym} за ${fmt(cost)}.`, 'good');
    render(); openBroker();
  });
  $('#card-modal').querySelectorAll('.brk-sell').forEach(b => b.onclick = () => {
    const sym=b.dataset.sym, hd=S.holdings[sym]; if(!hd) return;
    const n=Math.min(hd.shares, qty(sym)||hd.shares), price=S.prices[sym]||0;
    if(n<=0) return;
    S.cash += n*price; hd.shares -= n;
    if(hd.shares<=0) delete S.holdings[sym];
    log(`Продано ${n} × ${sym} за ${fmt(n*price)}.`, 'good');
    render(); openBroker();
  });
}

/* ====================================================================
   РАБОТЫ — уволиться / делегировать
   ==================================================================== */
function openJobs(){
  if(busy) return;
  const free = freeHours();

  // текущие работы
  const curRows = S.jobs.map((j,i) => {
    if(j.quit) return `<div class="brk-row"><div class="brk-info"><div class="brk-name">${j.name} <span class="asset-tag">уволен</span></div></div></div>`;
    let btns = '';
    if(j.delegate && !j.delegated) btns += `<button class="btn sm" data-deleg="${i}">${j.delegate.label||'Делегировать'}</button>`;
    if(j.canQuit) btns += `<button class="btn sm danger" data-quit="${i}">Уволиться</button>`;
    return `<div class="brk-row">
      <div class="brk-info"><div class="brk-name">${j.name}</div>
        <div class="brk-sub">${fmt(jobIncome(j))} · ${jobHours(j)} ч/мес · ${j.kind}${j.delegated?' · делегировано':''}</div>
        ${j.note?`<div class="brk-own">${j.note}</div>`:''}</div>
      <div class="brk-act">${btns}</div></div>`;
  }).join('');

  // рынок труда (вакансии, подработки, самозанятость)
  const activeNames = new Set(S.jobs.filter(j=>!j.quit).map(j=>j.name));
  const available = JOB_MARKET.filter(j => !activeNames.has(j.name));
  const marketRows = available.map((j,i) => {
    const kindCls = j.kind==='наёмная'?'badge-event':(j.kind==='подработка'?'badge-market':'badge-small');
    return `<div class="brk-row">
      <div class="brk-info"><div class="brk-name">${j.name} <span class="deck-badge ${kindCls}" style="font-size:10px">${j.kind}</span></div>
        <div class="brk-sub">${fmt(j.income)} · ${j.hours} ч/мес${j.domain?' · '+DOMAINS[j.domain]:''}</div>
        <div class="brk-own">${j.desc}</div></div>
      <div class="brk-act"><button class="btn sm primary" data-hire="${i}">Устроиться</button></div></div>`;
  }).join('');

  // КАВЕЛТ: главный выигрышный ход
  const hasKavelt = S.jobs.some(j => j.id === 'kavelt' && !j.quit);
  const kaveltBlock = hasKavelt ? '' : `
      <h4 style="margin:12px 0 8px;color:var(--green);font-size:13px;text-transform:uppercase;letter-spacing:1px">Главный ход — свой бизнес</h4>
      <div class="brk-row" style="border:1px solid var(--green)">
        <div class="brk-info">
          <div class="brk-name" style="color:var(--green)">Запустить КАВЕЛТ</div>
          <div class="brk-sub">Своя маржа · инжиниринг · стартует с 0, растёт со спросом</div>
          <div class="brk-own">Та же работа, что по найму, но свои клиенты. Доход без потолка. Нужно ${free >= 30 ? 'время и спрос' : '<span style="color:var(--red)">время (сейчас свободно только '+free+' ч)</span>'}.</div>
        </div>
        <div class="brk-act"><button class="btn sm primary" id="launch-kavelt" ${free>=15?'':'disabled'}>Запустить</button></div>
      </div>`;

  const freedomNote = !hasKavelt
    ? `<p class="yield-badge trap">Ты в крысиных бегах: два оклада с потолком, тонкий профицит, пассив ~5%. Сбережениями не выйти. <b>Запусти КАВЕЛТ</b> — переведи часы в свою маржу.</p>`
    : (S.jobs.every(j => j.id==='kavelt' || j.quit)
      ? '<p class="yield-badge great">На своей марже. Оклады сброшены. Излишек → в портфель.</p>'
      : `<p class="yield-badge weak">КАВЕЛТ запущен. Расти его до порога сброса следующего оклада. Свободно ${free} ч/мес.</p>`);

  openCard(`
    <div class="modal-head"><span class="deck-badge badge-event">работы и время</span><h3>Работы · свободно ${free} ч/мес</h3></div>
    <div class="modal-body" style="max-height:65vh;overflow-y:auto">
      ${freedomNote}
      ${kaveltBlock}
      <h4 style="margin:12px 0 8px;color:var(--text-dim);font-size:13px;text-transform:uppercase;letter-spacing:1px">Твои работы</h4>
      ${curRows}
      <h4 style="margin:16px 0 8px;color:var(--accent);font-size:13px;text-transform:uppercase;letter-spacing:1px">Рынок труда</h4>
      <p style="font-size:12px;color:var(--text-mut);margin-bottom:8px">Наёмная, подработки, самозанятость. Каждая стоит времени. Третий оклад - ловушка: ещё один потолок.</p>
      ${marketRows}
    </div>
    <div class="modal-foot"><button class="btn primary" id="jobs-close">Закрыть</button></div>`);
  $('#card-modal').classList.add('broker-modal');
  $('#jobs-close').onclick = () => closeCard();

  // запуск КАВЕЛТ
  const launchBtn = document.getElementById('launch-kavelt');
  if(launchBtn) launchBtn.onclick = () => {
    S.jobs.push({id:'kavelt', name:'КАВЕЛТ (свой бизнес)', income:0, hours:30, kind:'свой бизнес', canQuit:true, domain:'инжиниринг',
      note:'Своя маржа. Растёт со спросом. Ищи клиентов, часы → в оффер и касания.'});
    log('Запущен <b>КАВЕЛТ</b>! Пока доход 0 - нужен спрос (клиенты). Вкладывай часы в касания и оффер.', 'gold');
    render(); openJobs();
  };

  // увольнение
  $('#card-modal').querySelectorAll('[data-quit]').forEach(b => b.onclick = () => {
    const j = S.jobs[parseInt(b.dataset.quit)];
    if(!confirm(`Уволиться с «${j.name}»? Потеряешь ${fmt(jobIncome(j))}/мес, но освободишь ${jobHours(j)} ч.`)) return;
    j.quit = true; log(`Уволился с «${j.name}»: −${fmt(jobIncome(j))}/мес, +${jobHours(j)} ч.`, isFree()?'gold':'bad');
    render(); openJobs();
  });
  // делегирование
  $('#card-modal').querySelectorAll('[data-deleg]').forEach(b => b.onclick = () => {
    const j = S.jobs[parseInt(b.dataset.deleg)];
    j.delegated = true; log(`Делегировал «${j.name}»: доход ${fmt(jobIncome(j))}, время ${jobHours(j)} ч/мес.`, 'good');
    render(); openJobs();
  });
  // найм (устроиться на работу)
  $('#card-modal').querySelectorAll('[data-hire]').forEach(b => b.onclick = () => {
    const j = available[parseInt(b.dataset.hire)];
    S.jobs.push({ id:'j'+S.month+'_'+rnd(999), name:j.name, income:j.income, hours:j.hours, kind:j.kind, canQuit:true, domain:j.domain });
    log(`Устроился: <b>${j.name}</b> (${j.kind}) +${fmt(j.income)}/мес, +${j.hours} ч.`, 'good');
    render(); openJobs();
  });
}

/* ====================================================================
   УПРАВЛЕНИЕ АКТИВАМИ И ДОЛГАМИ
   ==================================================================== */
function manageAsset(id){
  const a = S.assets.find(x => x.id === id); if(!a) return;
  if(a.real){
    openCard(simpleModal('badge-event','актив', a.title, `Это твой действующий источник дохода (~${fmtSigned(assetMonthlyNet(a))}/мес), а не товар на продажу. Его можно только наращивать.`, 'Ясно'));
    $('#m-ok').onclick = () => closeCard(); return;
  }
  const salePrice = a.cost, net = salePrice - (a.debt||0);
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-market">актив</span><h3>${a.title}</h3></div>
    <div class="modal-body">
      <p class="deal-desc">Продажа по балансовой цене (премию иногда даёт «Рынок»). Уйдёт поток ${fmtSigned(assetMonthlyNet(a))}/мес и освободится ${a.hours||0} ч/мес.</p>
      <div class="deal-stats">${dealStat('Цена', fmt(salePrice))}${a.debt>0?dealStat('Минус долг', fmt(a.debt), 'neg'):''}${dealStat('На руки', fmt(net), net>=0?'pos':'neg')}${dealStat('Освободит', (a.hours||0)+' ч')}</div>
      ${(a.liquidity==='low')?`<p class="modal-note">Недвижимость/бизнес продаётся не мгновенно - в жизни это месяцы.</p>`:''}
    </div>
    <div class="modal-foot"><button class="btn ghost" id="a-keep">Оставить</button><button class="btn primary" id="a-sell">Продать за ${fmt(net)}</button></div>`);
  $('#a-keep').onclick = () => closeCard();
  $('#a-sell').onclick = () => { S.cash += net; S.assets = S.assets.filter(x=>x!==a); log(`Продан актив «${a.title}» за ${fmt(salePrice)} (на руки ${fmt(net)}).`, 'good'); closeCard(); render(); };
}
function manageLiability(name){
  const L = S.liabilities[name]; if(!L) return;
  const ratio = L.balance>0 ? L.payment/L.balance : 0;
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-event">досрочное гашение</span><h3>${name}</h3></div>
    <div class="modal-body"><p class="deal-desc">Гасим долг досрочно из наличных, кратно 1000 ₽. Платёж снижается пропорционально остатку.</p>
      <div class="deal-stats">${dealStat('Остаток', fmt(L.balance), 'neg')}${dealStat('Платёж/мес', fmt(L.payment))}${dealStat('Наличные', fmt(S.cash))}</div>
      <div class="qty-row"><label>Погасить (₽):</label><input type="number" id="pay-amt" value="${Math.min(L.balance, Math.floor(S.cash/1000)*1000)}" min="0" step="1000"></div></div>
    <div class="modal-foot"><button class="btn ghost" id="pay-cancel">Отмена</button><button class="btn primary" id="pay-do">Погасить</button></div>`);
  $('#pay-cancel').onclick = () => closeCard();
  $('#pay-do').onclick = () => {
    let amt = Math.floor((parseInt($('#pay-amt').value)||0)/1000)*1000;
    amt = Math.min(amt, L.balance, Math.floor(S.cash/1000)*1000);
    if(amt < 1000){ log('Нужно не меньше 1000 ₽ наличными.', ''); return; }
    L.balance -= amt; S.cash -= amt; L.payment = Math.round(L.balance*ratio);
    if(L.balance<=0) delete S.liabilities[name];
    log(`Досрочно погашено «${name}»: ${fmt(amt)}.`, 'good'); closeCard(); render();
  };
}

/* ====================================================================
   БАНКОВСКИЙ КРЕДИТ
   ==================================================================== */
function takeBankLoan(amount, silent){
  if(amount<=0) return;
  if(!S.liabilities['Банковский кредит']) S.liabilities['Банковский кредит']={balance:0,payment:0};
  const L = S.liabilities['Банковский кредит'];
  L.balance += amount; L.payment = Math.round(L.balance*LOAN_RATE); S.cash += amount;
  if(!silent) log(`Взят кредит ${fmt(amount)} (платёж ${fmt(L.payment)}/мес).`, 'bad');
}

/* Реальная кредитная нагрузка: банки дают по ПДН (платежи/доход ≤ потолка). */
function monthlyIncomeForCredit(){ return activeIncomeNet() + passiveNetMonthly(); }
function currentDebtPayments(){ let s=0; for(const k in S.liabilities) s+=S.liabilities[k].payment; return s; }
function pdn(){ const inc=monthlyIncomeForCredit(); return inc>0 ? currentDebtPayments()/inc : 1; }
function creditLimit(){
  const inc = monthlyIncomeForCredit();
  const roomPay = Math.max(0, CONFIG.maxPDN*inc - currentDebtPayments()); // запас платежа в месяц
  const byPDN = roomPay / LOAN_RATE;                                      // макс. тело при платеже 3%/мес
  const bankBal = (S.liabilities['Банковский кредит']||{}).balance || 0;
  const cap = CONFIG.consumerLoanCap - bankBal;
  return Math.max(0, Math.floor(Math.min(byPDN, cap)/1000)*1000);
}

function openLoanModal(){
  if(busy) return;
  const L = S.liabilities['Банковский кредит'];
  const hasLoan = L && L.balance > 0;
  const limit = creditLimit();
  const pdnPct = Math.round(pdn()*100);
  const pdnCls = pdnPct >= 50 ? 'trap' : pdnPct >= 35 ? 'weak' : 'good';
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-event">банк</span><h3>Потребительский кредит</h3></div>
    <div class="modal-body">
      <p class="deal-desc">Банк смотрит на долговую нагрузку (ПДН): платежи по всем кредитам не должны превышать ${Math.round(CONFIG.maxPDN*100)}% дохода. Ставка ~36% годовых (платёж 3% от долга в месяц).</p>
      <div class="yield-badge ${pdnCls}">Твоя долговая нагрузка (ПДН): <b>${pdnPct}%</b> · банки одобряют до ${Math.round(CONFIG.maxPDN*100)}%</div>
      <div class="deal-stats">
        ${dealStat('Доступный лимит', limit>0?fmt(limit):'отказ', limit>0?'pos':'neg')}
        ${dealStat('Платежи/доход', fmt(currentDebtPayments())+' / '+fmt(monthlyIncomeForCredit()))}
        ${hasLoan?dealStat('Текущий долг', fmt(L.balance), 'neg'):dealStat('Наличные', fmt(S.cash))}
      </div>
      ${limit<1000 ? `<p class="modal-note" style="color:var(--red)">Банк откажет: долговая нагрузка на пределе. Сначала погаси часть долгов или подними доход.</p>` :
        `<div class="qty-row"><label>Сумма (₽):</label><input type="number" id="loan-amt" value="${Math.min(limit,100000)}" min="1000" max="${limit}" step="1000"></div>`}
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="loan-cancel">Закрыть</button>
      ${hasLoan?`<button class="btn" id="loan-repay">Погасить</button>`:''}
      ${limit>=1000?`<button class="btn primary" id="loan-take">Взять</button>`:''}
    </div>`);
  $('#loan-cancel').onclick = () => closeCard();
  if(limit>=1000) $('#loan-take').onclick = () => {
    let amt = Math.floor((parseInt($('#loan-amt').value)||0)/1000)*1000;
    amt = Math.min(amt, creditLimit());
    if(amt < 1000){ log('Минимум 1000 ₽.', ''); return; }
    takeBankLoan(amt, false);
    closeCard(); render();
  };
  if(hasLoan) $('#loan-repay').onclick = () => {
    let amt = Math.min(L.balance, Math.floor(S.cash/1000)*1000);
    if(amt < 1000){ log('Нет наличных на гашение (нужно ≥1000 ₽).', ''); return; }
    // гасим всё доступное; для частичного - клик по строке долга в отчёте
    L.balance -= amt; S.cash -= amt; L.payment = Math.round(L.balance*LOAN_RATE);
    if(L.balance<=0) delete S.liabilities['Банковский кредит'];
    log(`Погашено по кредиту: ${fmt(amt)}.`, 'good');
    closeCard(); render();
  };
}

/* ====================================================================
   ПОКУПКА ПАССИВОВ (вещи для жизни, которые стоят денег)
   ==================================================================== */
function openLifestyle(){
  if(busy) return;
  const rows = LIFESTYLE_ITEMS.map((it, i) => {
    const canBuy = it.price > 0 ? S.cash >= it.price : true;
    const costLine = it.price > 0 ? `разово ${fmt(it.price)}` : '';
    const monthLine = it.monthly > 0 ? `${fmt(it.monthly)}/мес` : '';
    const loanLine = it.loanBalance > 0 ? `долг ${fmt(it.loanBalance)}` : '';
    const sub = [costLine, monthLine, loanLine].filter(Boolean).join(' · ');
    return `<div class="brk-row">
      <div class="brk-info">
        <div class="brk-name">${it.title} <span class="asset-tag">${it.kind}</span></div>
        <div class="brk-sub">${sub}</div>
        <div class="brk-own">${it.desc}</div></div>
      <div class="brk-act">
        <button class="btn sm${it.monthly>0||it.loanBalance>0?' danger':''}" data-buy-life="${i}" ${canBuy?'':'disabled'}>Купить</button>
      </div></div>`;
  }).join('');
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-doodad">пассивы</span><h3>Купить для жизни</h3></div>
    <div class="modal-body" style="max-height:65vh;overflow-y:auto">
      <p class="yield-badge trap">По Кийосаки: всё, что вынимает деньги из кармана - пассив.
        Машина, квартира для себя, рассрочки, подписки - удобно, но каждый пункт отдаляет от свободы.</p>
      ${rows}
    </div>
    <div class="modal-foot"><button class="btn primary" id="life-close">Закрыть</button></div>`);
  $('#card-modal').classList.add('broker-modal');
  $('#life-close').onclick = () => closeCard();
  $('#card-modal').querySelectorAll('[data-buy-life]').forEach(b => b.onclick = () => {
    const it = LIFESTYLE_ITEMS[parseInt(b.dataset.buyLife)];
    if(it.price > 0 && S.cash < it.price){ log('Не хватает наличных.', ''); return; }
    if(it.price > 0) S.cash -= it.price;
    if(it.monthly > 0){
      const key = it.title;
      S.expenses[key] = (S.expenses[key] || 0) + it.monthly;
    }
    if(it.loanBalance > 0){
      const key = it.title;
      const payment = Math.round(it.loanBalance * LOAN_RATE);
      S.liabilities[key] = { balance: it.loanBalance, payment: it.monthly > 0 ? it.monthly : payment };
    }
    const parts = [];
    if(it.price > 0) parts.push(`−${fmt(it.price)} нал.`);
    if(it.monthly > 0) parts.push(`+${fmt(it.monthly)}/мес расходы`);
    if(it.loanBalance > 0) parts.push(`долг ${fmt(it.loanBalance)}`);
    log(`Купил: <b>${it.title}</b> (${parts.join(', ')}). Это пассив.`, 'bad');
    render(); openLifestyle();
  });
}

/* ====================================================================
   СОВЕТНИК
   ==================================================================== */
/* Советник ведёт по выигрышной последовательности из брифа:
   1) Найти часы → 2) Часы в КАВЕЛТ → 3) Сбросить КАЭЛ → 4) Сбросить Райз → 5) Портфель → 6) Мечта */
function advisorTip(act, pas, exp, cf){
  const ov = overload(), free = freeHours();
  const kavelt = S.jobs.find(j => j.id === 'kavelt' && !j.quit);
  const kaveltIncome = kavelt ? jobIncome(kavelt) : 0;
  const kael = S.jobs.find(j => j.id === 'kael' && !j.quit);
  const kaelIncome = kael ? jobIncome(kael) : 0;
  const rise = S.jobs.find(j => j.id === 'rise' && !j.quit);
  const riseIncome = rise ? jobIncome(rise) : 0;
  const ip = S.liabilities['Ипотека (16,9%)'];

  // критические
  if(ov > 0) return `<b>Перегруз ${ov} ч!</b> Доход режется, копится выгорание. Освободи часы: «Работы» → уволиться / делегировать. Часы - валюта, не сжигай их.`;
  if(cf < 0) return '<b>Поток минусовой.</b> Гаси дорогие долги, не бери пассивы. Авто в кредит сейчас - ловушка.';

  // фаза 0: нет КАВЕЛТ - главный ход
  if(!kavelt){
    if(free < 20) return `Свободных часов мало (${free}). Сожми КАЭЛ через ИИ или найди «потерянные» часы (дневник). Твоя валюта - время, не деньги.`;
    return `<b>Главный ход:</b> свободные ${free} ч → в КАВЕЛТ. Запусти свой бизнес (кнопка «Работы» или клетка «Сделка»): оффер, касания, первые свои клиенты. Спрос важнее денег.`;
  }

  // фаза 1: КАВЕЛТ есть, растёт к порогу КАЭЛ
  if(kael && kaveltIncome < kaelIncome)
    return `КАВЕЛТ приносит ${fmt(kaveltIncome)}, КАЭЛ - ${fmt(kaelIncome)}. <b>Порог 1:</b> когда КАВЕЛТ >= КАЭЛ → сбрось КАЭЛ и забери ${kael.hours} ч. Осталось ${fmt(kaelIncome - kaveltIncome)}.`;

  // порог 1 достигнут, КАЭЛ ещё не сброшен
  if(kael && kaveltIncome >= kaelIncome)
    return `<b>ПОРОГ 1 достигнут!</b> КАВЕЛТ (${fmt(kaveltIncome)}) >= КАЭЛ (${fmt(kaelIncome)}). Сбрось КАЭЛ → +${kael.hours} ч в КАВЕЛТ. Жми «Работы».`;

  // фаза 2: КАЭЛ сброшен, растём к порогу Райза
  if(rise && kaveltIncome < riseIncome)
    return `КАВЕЛТ ${fmt(kaveltIncome)}, Райз ${fmt(riseIncome)}. <b>Порог 2:</b> когда КАВЕЛТ повторяемо >= Райз → сдай Райз и забери ${rise.hours} ч. Осталось ${fmt(riseIncome - kaveltIncome)}.`;

  // порог 2 достигнут
  if(rise && kaveltIncome >= riseIncome)
    return `<b>ПОРОГ 2! КАВЕЛТ (${fmt(kaveltIncome)}) >= Райз (${fmt(riseIncome)}).</b> Сдавай Райз → +${rise.hours} ч. Это ВЫХОД из крысиных бегов.`;

  // фаза 3: оба оклада сброшены - портфель
  if(!rise && !kael){
    if(ip) return `Оклады сброшены, ты на своей марже. Фоном убивай ипотеку (${fmt(ip.balance)} @16,9%). Излишек → в портфель (индекс/ОФЗ). Цель: 108 млн.`;
    const portf = securitiesValue();
    if(portf >= 108e6) return '<b>ПОРТФЕЛЬ 108 МЛН!</b> Fast Track: квартира-мечта, BMW, путешествия - из процентов, а не из зарплаты. Ты прошёл игру.';
    return `Излишек КАВЕЛТ → в портфель. Сейчас ${fmt(portf)}, цель 108 млн. Реинвестируй дисциплинированно, сложный процент сделает остальное.`;
  }

  return `Свободно ${free} ч. Каждый час - или в КАВЕЛТ (рост маржи), или потерян. Спрос важнее денег, часы важнее спроса.`;
}
function passiveBaseline(){
  let s=0; for(const a of S.assets) if(a.real) s+=assetMonthlyNet(a); return s;
}

/* ====================================================================
   СПРАВКА
   ==================================================================== */
function openHelp(){
  const secs = HELP_SECTIONS.map(s=>`<div class="help-sec"><h4>${s.h}</h4><p>${s.p}</p></div>`).join('');
  openCard(`<div class="modal-head"><span class="deck-badge badge-small">справка</span><h3>Принципы и правила игры</h3></div>
    <div class="modal-body" style="max-height:62vh;overflow-y:auto">${secs}</div>
    <div class="modal-foot"><button class="btn primary" id="help-close">Понятно</button></div>`);
  $('#card-modal').classList.add('help-modal');
  $('#help-close').onclick = () => closeCard();
}

/* ====================================================================
   ПОБЕДА
   ==================================================================== */
function checkWin(){
  if(S.won) return;
  if(isFree()){
    S.won = true; busy = true; render();
    openCard(`<div class="modal win-screen">
      <div class="modal-head"><span class="deck-badge badge-small">свобода</span><h3>🎉 Финансовая свобода!</h3></div>
      <div class="modal-body"><div class="win-big">🏁</div>
        <p class="deal-desc">Пассивный доход (${fmt(passiveNetMonthly())}/мес) покрыл расходы (${fmt(expensesMonthly())}/мес). Тебе ${curAge()} лет, на дворе ${dateLabel()}.</p>
        <p class="modal-note">Теперь зайди в «Работы» и уйди с найма - освободишь время и внимание, чтобы растить активы кратно быстрее. Это и есть приз: не «лежать», а перебросить время в создание большего.</p></div>
      <div class="modal-foot"><button class="btn" id="win-jobs">К работам</button><button class="btn primary" id="win-go">Продолжить</button></div></div>`);
    log(`🎉 СВОБОДА в ${dateLabel()}, в ${curAge()} лет! Пассивный доход покрыл расходы.`, 'gold');
    $('#win-go').onclick = () => { closeCard(); busy=false; render(); };
    $('#win-jobs').onclick = () => { closeCard(); busy=false; render(); openJobs(); };
  }
}

/* ====================================================================
   ИНИЦИАЛИЗАЦИЯ
   ==================================================================== */
function init(){
  buildBoardPositions();
  renderProfGrid();
  $('#btn-start').onclick = () => { if(selectedProf) startGame(selectedProf); };
  $('#btn-roll').onclick = onRollClick;
  $('#dice').onclick = onRollClick;
  $('#btn-help').onclick = openHelp;
  $('#btn-broker').onclick = openBroker;
  $('#btn-jobs').onclick = openJobs;
  $('#btn-loan').onclick = openLoanModal;
  $('#btn-lifestyle').onclick = openLifestyle;

  $('#stmt-assets').addEventListener('click', (e)=>{ const r=e.target.closest('[data-aid]'); if(r) manageAsset(r.dataset.aid); });
  $('#stmt-income').addEventListener('click', (e)=>{ const r=e.target.closest('[data-aid]'); if(r) manageAsset(r.dataset.aid); });
  $('#stmt-liab').addEventListener('click', (e)=>{ const r=e.target.closest('[data-liab]'); if(r) manageLiability(r.dataset.liab); });

  $('#btn-restart').onclick = () => {
    if(confirm('Начать новую игру? Прогресс сбросится.')){
      clearSave(); S=null; selectedProf=null;
      $('#game-view').style.display='none';
      $('#btn-start').disabled=true; $('#start-note').textContent='Профиль не выбран';
      document.querySelectorAll('.prof-card').forEach(c=>c.classList.remove('sel'));
      $('#start-overlay').classList.add('show');
    }
  };
  $('#btn-reset').onclick = () => { if(confirm('Полный сброс сохранения?')){ clearSave(); location.reload(); } };

  const saved = loadSave();
  if(saved && saved.prof){
    S = saved; busy=false;
    $('#start-overlay').classList.remove('show');
    $('#game-view').style.display='grid';
    render();
    log('Игра загружена.', 'info');
  }
}
document.addEventListener('DOMContentLoaded', init);
