/* ====================================================================
   CASHFLOW — игровая логика (Крысиные бега, прототип v0.1)
   Чистый JS, без зависимостей. Сохранение в localStorage.
   ==================================================================== */
'use strict';

const SAVE_KEY = 'cashflow_save_v1';
const LOAN_RATE = 0.03;   // платёж по банковскому кредиту = 3% от долга/мес (~36% годовых, потребкредит РФ)

/* ----------------------- Состояние игры ----------------------- */
let S = null;        // объект текущей игры
let busy = false;    // блокировка во время анимаций/модалок

/* ----------------------- Утилиты ----------------------- */
const $ = (sel) => document.querySelector(sel);
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];

function fmt(n){
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}
function fmtSigned(n){ return (n >= 0 ? '+' : '') + fmt(n); }

/* ----------------------- Финансовые расчёты ----------------------- */
function passiveIncome(){
  let p = 0;
  for(const a of S.assets){
    if(a.kind === 'stock'){ p += Math.round((a.dividend || 0) * a.shares); }
    else { p += a.cashflow || 0; }
  }
  return p;
}
function liabPayments(){
  let p = 0;
  for(const k in S.liabilities){ p += S.liabilities[k].payment; }
  return p;
}
function childExpense(){ return S.children * S.perChild; }
function totalIncome(){ return S.salary + passiveIncome(); }
function totalExpense(){ return S.taxes + S.otherExpenses + childExpense() + liabPayments(); }
function cashflow(){ return totalIncome() - totalExpense(); }
function isFree(){ return passiveIncome() >= totalExpense(); }

/* ----------------------- Журнал ----------------------- */
function log(msg, cls){
  S.log.unshift({ msg, cls: cls || '', turn: S.turn });
  if(S.log.length > 60) S.log.pop();
  renderLog();
}
function renderLog(){
  const el = $('#log');
  el.innerHTML = S.log.map(e =>
    `<div class="log-entry ${e.cls}"><span style="color:var(--text-mut);font-size:11px">[${e.turn}]</span> ${e.msg}</div>`
  ).join('');
}

/* ====================================================================
   ДОСКА (SVG)
   7×7 кольцо = 24 клетки по периметру.
   ==================================================================== */
const ICONS = { deal:'💼', payday:'💰', doodad:'🛒', market:'📈', charity:'❤️', baby:'👶', downsized:'⚠️' };
let CELL_POS = [];

function buildBoardPositions(){
  CELL_POS = [];
  const N = 7, margin = 14, area = 560 - margin*2, step = area / N, cw = step - 6;
  const grid = []; // последовательность (col,row) по периметру по часовой
  for(let c=0; c<N; c++) grid.push([c,0]);            // верх →
  for(let r=1; r<N; r++) grid.push([N-1,r]);          // правый ↓
  for(let c=N-2; c>=0; c--) grid.push([c,N-1]);       // низ ←
  for(let r=N-2; r>=1; r--) grid.push([0,r]);         // левый ↑
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
  // центр
  html += `<text x="280" y="262" text-anchor="middle" style="fill:var(--text-mut);font-size:13px;letter-spacing:3px">КРЫСИНЫЕ</text>`;
  html += `<text x="280" y="284" text-anchor="middle" style="fill:var(--text-mut);font-size:13px;letter-spacing:3px">БЕГА</text>`;
  html += `<text x="280" y="312" text-anchor="middle" style="fill:var(--accent);font-size:11px;letter-spacing:1px" id="board-round"></text>`;
  // фишка
  const p0 = CELL_POS[S.position];
  html += `<circle class="token" id="token" cx="${p0.cx}" cy="${p0.cy}" r="11"/>`;
  svg.innerHTML = html;
  $('#board-round').textContent = 'Ход ' + S.turn;
}

function moveToken(idx){
  const p = CELL_POS[idx], t = $('#token');
  if(t){ t.setAttribute('cx', p.cx); t.setAttribute('cy', p.cy); }
}

/* ====================================================================
   РЕНДЕР ПАНЕЛЕЙ
   ==================================================================== */
function render(){
  const inc = totalIncome(), exp = totalExpense(), pas = passiveIncome(), cf = cashflow();

  // приборная панель
  $('#m-income').textContent  = fmt(inc);
  $('#m-expense').textContent = fmt(exp);
  $('#m-passive').textContent = fmt(pas);
  const cfEl = $('#m-cashflow');
  cfEl.textContent = fmtSigned(cf);
  cfEl.className = 'm-val ' + (cf >= 0 ? 'pos' : 'neg');
  $('#m-cash').textContent = fmt(S.cash);

  // цель: пассивный доход против расходов
  const gap = exp - pas;
  const goalNum = $('#goal-num');
  if(gap <= 0){
    goalNum.textContent = 'СВОБОДА!';
    goalNum.classList.add('win');
    $('#goal-sub').textContent = 'пассивный доход покрывает расходы';
  }else{
    goalNum.textContent = fmt(gap);
    goalNum.classList.remove('win');
    $('#goal-sub').textContent = `пассивный ${fmt(pas)} из ${fmt(exp)} расходов`;
  }
  const pct = Math.max(0, Math.min(100, exp > 0 ? (pas/exp*100) : 0));
  $('#goal-bar').style.width = pct + '%';

  // строка игрока
  $('#player-line').textContent = `${S.name} · ${'👶'.repeat(S.children) || 'без детей'}`;

  // советник
  const adv = $('#advisor'); if(adv) adv.innerHTML = advisorTip(inc, exp, pas, cf);

  renderStatement(inc, exp, pas);
  renderBoard();
  renderLog();
  $('#btn-loan').disabled = busy;
  $('#btn-roll').disabled = busy;
  save();
}

function renderStatement(inc, exp, pas){
  // Доходы
  let h = `<div class="stmt-row"><span class="lbl">Зарплата</span><span class="num">${fmt(S.salary)}</span></div>`;
  h += `<div class="stmt-row"><span class="lbl">Пассивный доход</span><span class="num pos">${fmt(pas)}</span></div>`;
  h += `<div class="stmt-total"><span>Итого доход</span><span>${fmt(inc)}</span></div>`;
  $('#stmt-income').innerHTML = h;

  // Расходы
  h = `<div class="stmt-row"><span class="lbl">Налоги</span><span class="num">${fmt(S.taxes)}</span></div>`;
  h += `<div class="stmt-row"><span class="lbl">Прочие расходы</span><span class="num">${fmt(S.otherExpenses)}</span></div>`;
  if(S.children > 0)
    h += `<div class="stmt-row"><span class="lbl">На детей (${S.children})</span><span class="num">${fmt(childExpense())}</span></div>`;
  for(const k in S.liabilities)
    h += `<div class="stmt-row"><span class="lbl">${k}</span><span class="num">${fmt(S.liabilities[k].payment)}</span></div>`;
  h += `<div class="stmt-total"><span>Итого расход</span><span>${fmt(exp)}</span></div>`;
  $('#stmt-expense').innerHTML = h;

  // Активы
  if(S.assets.length === 0){
    $('#stmt-assets').innerHTML = `<div class="stmt-row"><span class="lbl" style="font-style:italic;color:var(--text-mut)">пока нет активов</span></div>`;
  }else{
    h = '';
    for(const a of S.assets){
      if(a.kind === 'stock'){
        h += `<div class="stmt-row"><span class="lbl">${a.title} <span class="asset-tag">${a.shares} шт × ${fmt(a.price)}</span></span><span class="num">${fmt(a.shares*a.price)}</span></div>`;
      }else{
        const tag = a.real ? 'своё' : (a.kind === 'realestate' ? 'аренда' : 'бизнес');
        const val = a.cost > 0 ? fmt(a.cost) : '—';
        h += `<div class="stmt-row"><span class="lbl">${a.title} <span class="asset-tag">${tag} +${fmt(a.cashflow)}</span></span><span class="num">${val}</span></div>`;
      }
    }
    $('#stmt-assets').innerHTML = h;
  }

  // Пассивы
  if(Object.keys(S.liabilities).length === 0){
    $('#stmt-liab').innerHTML = `<div class="stmt-row"><span class="lbl" style="font-style:italic;color:var(--text-mut)">долгов нет</span></div>`;
  }else{
    h = '';
    for(const k in S.liabilities)
      h += `<div class="stmt-row"><span class="lbl">${k}</span><span class="num neg">${fmt(S.liabilities[k].balance)}</span></div>`;
    // ипотеки по недвижимости (привязаны к активам)
    for(const a of S.assets){
      if(a.debt > 0)
        h += `<div class="stmt-row"><span class="lbl">Ипотека: ${a.title}</span><span class="num neg">${fmt(a.debt)}</span></div>`;
    }
    $('#stmt-liab').innerHTML = h;
  }
}

/* ====================================================================
   МОДАЛКИ
   ==================================================================== */
function openCard(html){
  $('#card-modal').className = 'modal';   // сброс спец-классов (напр. help-modal)
  $('#card-modal').innerHTML = html;
  $('#card-overlay').classList.add('show');
}
function closeCard(){ $('#card-overlay').classList.remove('show'); }

function dealStat(label, val, cls){
  return `<div class="deal-stat"><div class="ds-l">${label}</div><div class="ds-v ${cls||''}">${val}</div></div>`;
}

/* Индикатор качества сделки: годовая доходность на вложенные деньги + вердикт.
   invested — наличные на входе (взнос/цена), annualCf — поток за год. */
function yieldBadge(invested, annualCf){
  if(annualCf <= 0){
    return `<div class="yield-badge trap">⚠ Поток минусовой - это пассив, а не актив. Будешь кормить его из зарплаты.</div>`;
  }
  if(invested <= 0) return '';
  const y = annualCf / invested;            // годовая доходность
  const pct = Math.round(y * 100);
  let cls, verdict;
  if(y >= 0.25){ cls='great'; verdict='Отличный денежный поток'; }
  else if(y >= 0.12){ cls='good'; verdict='Хороший актив'; }
  else if(y >= 0.05){ cls='weak'; verdict='Слабая доходность - окупается долго'; }
  else { cls='weak'; verdict='Очень слабо - почти как вклад, но с риском'; }
  return `<div class="yield-badge ${cls}">Доходность ≈ <b>${pct}%</b> годовых на вложенное · ${verdict}</div>`;
}

/* ====================================================================
   СОХРАНЕНИЕ
   ==================================================================== */
function save(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(S)); }catch(e){}
}
function loadSave(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){ return null; }
}
function clearSave(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }

/* ====================================================================
   СТАРТ ИГРЫ
   ==================================================================== */
let selectedProf = null;

function renderProfGrid(){
  const grid = $('#prof-grid');
  grid.innerHTML = ALL_PROFILES.map(p => {
    let liabPay = 0; for(const k in p.liabilities) liabPay += p.liabilities[k].payment;
    const exp = p.taxes + p.otherExpenses + liabPay;
    let passive = 0; (p.startAssets || []).forEach(a => passive += a.cashflow || 0);
    const cf = p.salary + passive - exp;
    const featured = p.real ? ' featured' : '';
    const passiveLine = passive > 0
      ? `<div class="pc-line"><span>Пассивный</span><span class="num pc-cf">${fmt(passive)}</span></div>` : '';
    return `<button class="prof-card${featured}" data-id="${p.id}">
      <div class="pc-name">${p.real ? '★ ' : ''}${p.name}</div>
      <div class="pc-line"><span>${p.real ? 'Активный доход' : 'Зарплата'}</span><span class="num">${fmt(p.salary)}</span></div>
      ${passiveLine}
      <div class="pc-line"><span>Расходы</span><span class="num">${fmt(exp)}</span></div>
      <div class="pc-line"><span>Ден. поток</span><span class="num pc-cf">${fmtSigned(cf)}</span></div>
      <div class="pc-line"><span>Наличные</span><span class="num">${fmt(p.cash)}</span></div>
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
  // стартовые активы (для профиля «Я» — уже имеющийся пассивный доход)
  const assets = (p.startAssets || []).map((a, i) => Object.assign({ id: 'seed'+i }, a));
  S = {
    prof: p.id, name: p.name, real: !!p.real,
    salary: p.salary, cash: p.cash,
    children: 0, perChild: p.perChild,
    taxes: p.taxes, otherExpenses: p.otherExpenses,
    liabilities: JSON.parse(JSON.stringify(p.liabilities)),
    assets: assets,
    position: 0, turn: 1,
    charityTurns: 0, skipTurns: 0,
    won: false,
    log: [],
  };
  $('#start-overlay').classList.remove('show');
  $('#game-view').style.display = 'grid';
  if(p.real){
    log(`Старт от себя! Активный доход ${fmt(p.salary)}, пассивный ${fmt(passiveIncome())}. До выхода из крысиных бегов: ${fmt(Math.max(0,totalExpense()-passiveIncome()))}/мес пассивного потока.`, 'gold');
  }else{
    log(`Старт! Профессия: <b>${p.name}</b>. Цель - пассивный доход ≥ расходов (${fmt(totalExpense())}/мес).`, 'gold');
  }
  render();
}

/* ====================================================================
   ХОД: КУБИК И ДВИЖЕНИЕ
   ==================================================================== */
function onRollClick(){
  if(busy) return;
  // пропуск хода (увольнение)
  if(S.skipTurns > 0){
    S.skipTurns--;
    log(`Пропуск хода (осталось пропустить: ${S.skipTurns}).`, 'bad');
    S.turn++;
    render();
    return;
  }
  // благотворительность: выбор количества кубиков
  if(S.charityTurns > 0){
    chooseDiceCount();
    return;
  }
  doRoll(1);
}

function chooseDiceCount(){
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-event">бонус</span><h3>Благотворительность активна</h3></div>
    <div class="modal-body">
      <p class="deal-desc">Вы можете бросить 1 или 2 кубика (осталось таких ходов: ${S.charityTurns}).</p>
    </div>
    <div class="modal-foot">
      <button class="btn" id="dc1">Один кубик</button>
      <button class="btn primary" id="dc2">Два кубика</button>
    </div>`);
  $('#dc1').onclick = () => { closeCard(); S.charityTurns--; doRoll(1); };
  $('#dc2').onclick = () => { closeCard(); S.charityTurns--; doRoll(2); };
}

function doRoll(diceCount){
  busy = true; render();
  const dice = $('#dice');
  dice.classList.add('rolling');
  $('#turn-hint').textContent = 'Кубик брошен...';

  let d1 = 1 + rnd(6), d2 = diceCount === 2 ? 1 + rnd(6) : 0;
  const steps = d1 + d2;

  setTimeout(() => {
    dice.classList.remove('rolling');
    dice.textContent = diceCount === 2 ? `${d1}+${d2}` : ['','⚀','⚁','⚂','⚃','⚄','⚅'][d1];
    log(`Бросок: <b>${steps}</b>${diceCount===2?` (${d1}+${d2})`:''}.`, 'info');
    animateMove(steps);
  }, 500);
}

function animateMove(steps){
  let moved = 0;
  const N = BOARD.length;
  const stepOnce = () => {
    if(moved >= steps){ arrive(); return; }
    S.position = (S.position + 1) % N;
    moved++;
    moveToken(S.position);
    // прошли «День зарплаты» (но не финальную клетку — её обработает arrive)
    if(moved < steps && BOARD[S.position].type === 'payday'){
      const cf = cashflow();
      S.cash += cf;
      log(`Прошли День зарплаты: денежный поток ${fmtSigned(cf)}.`, cf>=0?'good':'bad');
      renderStatementOnly();
    }
    setTimeout(stepOnce, 180);
  };
  setTimeout(stepOnce, 180);
}

function renderStatementOnly(){
  $('#m-cash').textContent = fmt(S.cash);
}

function arrive(){
  S.turn++;
  const cell = BOARD[S.position];
  handleCell(cell);
}

/* ====================================================================
   ОБРАБОТКА КЛЕТОК
   ==================================================================== */
function handleCell(cell){
  switch(cell.type){
    case 'deal':      cellDeal(); break;
    case 'payday':    cellPayday(); break;
    case 'doodad':    cellDoodad(); break;
    case 'market':    cellMarket(); break;
    case 'charity':   cellCharity(); break;
    case 'baby':      cellBaby(); break;
    case 'downsized': cellDownsized(); break;
    default:          endTurn();
  }
}

function endTurn(){
  busy = false;
  $('#turn-hint').textContent = 'Ваш ход. Бросьте кубик.';
  render();
  checkWin();
}

/* ---------- Зарплата ---------- */
function cellPayday(){
  const cf = cashflow();
  S.cash += cf;
  log(`День зарплаты! Денежный поток ${fmtSigned(cf)}.`, cf>=0?'good':'bad');
  endTurn();
}

/* ---------- Сделка: выбор малая/крупная ---------- */
function cellDeal(){
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-big">сделка</span><h3>Возможность для сделки</h3></div>
    <div class="modal-body">
      <p class="deal-desc">Выберите колоду. Малые сделки - дёшево, небольшой поток. Крупные - дорого, но мощный поток.</p>
      <div class="deal-stats">
        ${dealStat('Малая сделка','💼 дёшево')}
        ${dealStat('Крупная сделка','🏢 дорого')}
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="deal-skip">Пропустить ход</button>
      <button class="btn" id="deal-small">Малая</button>
      <button class="btn primary" id="deal-big">Крупная</button>
    </div>`);
  $('#deal-skip').onclick = () => { closeCard(); log('Сделка пропущена.', ''); endTurn(); };
  $('#deal-small').onclick = () => showDeal(pick(SMALL_DEALS), 'small');
  $('#deal-big').onclick   = () => showDeal(pick(BIG_DEALS), 'big');
}

function showDeal(deal, size){
  const badge = size === 'small'
    ? '<span class="deck-badge badge-small">малая сделка</span>'
    : '<span class="deck-badge badge-big">крупная сделка</span>';

  if(deal.kind === 'stock') return showStockDeal(deal, badge);

  // недвижимость / бизнес
  const canBuy = S.cash >= deal.down;
  let stats = dealStat('Первый взнос', fmt(deal.down));
  stats += dealStat('Полная цена', fmt(deal.cost));
  if(deal.mortgage > 0) stats += dealStat('Ипотека', fmt(deal.mortgage), 'neg');
  stats += dealStat('Поток / мес', fmtSigned(deal.cashflow), 'pos');

  openCard(`
    <div class="modal-head">${badge}<h3>${deal.title}</h3></div>
    <div class="modal-body">
      <p class="deal-sub">${deal.sub}</p>
      <div class="deal-stats">${stats}</div>
      ${yieldBadge(deal.down, deal.cashflow * 12)}
      <p class="deal-desc">${deal.desc}</p>
    </div>
    <div class="modal-foot">
      <span class="modal-note">${canBuy ? 'Наличных хватает' : 'Не хватает наличных на взнос'}</span>
      <button class="btn ghost" id="d-skip">Отказаться</button>
      <button class="btn primary" id="d-buy" ${canBuy?'':'disabled'}>Купить за ${fmt(deal.down)}</button>
    </div>`);
  $('#d-skip').onclick = () => { closeCard(); log(`Отказ: ${deal.title}.`, ''); endTurn(); };
  $('#d-buy').onclick = () => {
    S.cash -= deal.down;
    S.assets.push({
      id: 'a'+Date.now()+rnd(999),
      kind: deal.kind, title: deal.title,
      cost: deal.cost, debt: deal.mortgage || 0, cashflow: deal.cashflow,
    });
    log(`Куплено: <b>${deal.title}</b> за ${fmt(deal.down)}. Поток ${fmtSigned(deal.cashflow)}/мес.`, 'good');
    closeCard(); endTurn();
  };
}

function showStockDeal(deal, badge){
  const owned = S.assets.find(a => a.symbol === deal.symbol);
  const divLine = deal.dividend > 0 ? `Дивиденд ${fmt(deal.dividend)}/акция в мес` : 'Без дивидендов (спекуляция)';
  openCard(`
    <div class="modal-head">${badge}<h3>${deal.title}</h3></div>
    <div class="modal-body">
      <p class="deal-sub">${deal.sub} · ${deal.symbol}</p>
      <div class="deal-stats">
        ${dealStat('Цена за акцию', fmt(deal.price))}
        ${dealStat('Дивиденд', deal.dividend>0?fmt(deal.dividend):'—', 'pos')}
      </div>
      ${deal.dividend > 0 ? yieldBadge(deal.price, deal.dividend * 12) : '<div class="yield-badge weak">Без дивидендов: заработок только на перепродаже дороже. Потока нет.</div>'}
      <p class="deal-desc">${deal.desc} ${divLine}.</p>
      <div class="qty-row">
        <label>Сколько акций:</label>
        <input type="number" id="qty" value="100" min="1" step="1">
        <span id="qty-cost" style="font-family:var(--mono)"></span>
      </div>
      ${owned ? `<p class="modal-note">У вас уже есть ${owned.shares} шт по ${fmt(owned.price)}.</p>` : ''}
    </div>
    <div class="modal-foot">
      <span class="modal-note" id="stock-note"></span>
      <button class="btn ghost" id="s-skip">Отказаться</button>
      <button class="btn primary" id="s-buy">Купить</button>
    </div>`);

  const qty = $('#qty'), note = $('#stock-note'), costEl = $('#qty-cost');
  const upd = () => {
    const n = Math.max(0, parseInt(qty.value) || 0);
    const cost = n * deal.price;
    costEl.textContent = '= ' + fmt(cost);
    const ok = n > 0 && cost <= S.cash;
    note.textContent = cost > S.cash ? 'Не хватает наличных' : '';
    $('#s-buy').disabled = !ok;
  };
  qty.addEventListener('input', upd); upd();

  $('#s-skip').onclick = () => { closeCard(); log(`Отказ: акции ${deal.symbol}.`, ''); endTurn(); };
  $('#s-buy').onclick = () => {
    const n = Math.max(0, parseInt(qty.value) || 0);
    const cost = n * deal.price;
    if(n <= 0 || cost > S.cash) return;
    S.cash -= cost;
    const ex = S.assets.find(a => a.symbol === deal.symbol);
    if(ex){
      // усреднение цены
      const totalShares = ex.shares + n;
      ex.price = Math.round((ex.price*ex.shares + deal.price*n) / totalShares);
      ex.shares = totalShares;
    }else{
      S.assets.push({ id:'a'+Date.now()+rnd(999), kind:'stock', title:deal.title,
        symbol:deal.symbol, shares:n, price:deal.price, dividend:deal.dividend||0 });
    }
    log(`Куплено ${n} акций <b>${deal.symbol}</b> за ${fmt(cost)}.`, 'good');
    closeCard(); endTurn();
  };
}

/* ---------- Всякая всячина ---------- */
function cellDoodad(){
  const card = pick(DOODAD_CARDS);
  const needLoan = S.cash < card.amount;
  let loanAmt = 0;
  if(needLoan){ loanAmt = Math.ceil((card.amount - S.cash)/1000)*1000; }
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-doodad">всякая всячина</span><h3>${card.title}</h3></div>
    <div class="modal-body">
      <p class="deal-desc">${card.desc}</p>
      <div class="deal-stats">${dealStat('К оплате', fmt(card.amount), 'neg')}${dealStat('Наличные', fmt(S.cash))}</div>
      ${needLoan ? `<p class="modal-note" style="color:var(--red)">Наличных не хватает - придётся взять кредит ${fmt(loanAmt)} (платёж +${fmt(Math.round(loanAmt*LOAN_RATE))}/мес).</p>` : ''}
    </div>
    <div class="modal-foot">
      <button class="btn primary" id="dd-pay">${needLoan?'Взять кредит и оплатить':'Оплатить'}</button>
    </div>`);
  $('#dd-pay').onclick = () => {
    if(needLoan){ takeBankLoan(loanAmt, true); }
    S.cash -= card.amount;
    log(`Непредвиденный расход: <b>${card.title}</b> ${fmt(card.amount)}.`, 'bad');
    closeCard(); endTurn();
  };
}

/* ---------- Рынок ---------- */
function cellMarket(){
  const card = pick(MARKET_CARDS);

  if(card.type === 'nothing'){
    openCard(simpleModal('badge-market','рынок', card.title, card.desc, 'Ясно'));
    $('#m-ok').onclick = () => { closeCard(); log('Рынок: затишье.', ''); endTurn(); };
    return;
  }

  if(card.type === 'stock_price'){
    S.marketPrices = S.marketPrices || {};
    S.marketPrices[card.symbol] = card.newPrice;
    const owned = S.assets.find(a => a.symbol === card.symbol);
    let body = `<p class="deal-desc">${card.desc}</p>`;
    body += `<div class="deal-stats">${dealStat('Текущая цена', fmt(card.newPrice))}${dealStat('Вы держите', owned?`${owned.shares} шт`:'—')}</div>`;
    let foot = '';
    if(owned){
      const total = owned.shares * card.newPrice;
      foot = `<span class="modal-note">Продажа всего пакета: ${fmt(total)}</span>
        <button class="btn ghost" id="mk-skip">Держать</button>
        <button class="btn primary" id="mk-sell">Продать всё за ${fmt(total)}</button>`;
    }else{
      foot = `<button class="btn primary" id="mk-skip">Ясно</button>`;
    }
    openCard(`<div class="modal-head"><span class="deck-badge badge-market">рынок</span><h3>${card.title}</h3></div>
      <div class="modal-body">${body}</div><div class="modal-foot">${foot}</div>`);
    if($('#mk-skip')) $('#mk-skip').onclick = () => { closeCard(); endTurn(); };
    if($('#mk-sell')) $('#mk-sell').onclick = () => {
      const total = owned.shares * card.newPrice;
      S.cash += total;
      S.assets = S.assets.filter(a => a !== owned);
      log(`Продано ${owned.shares} акций <b>${card.symbol}</b> за ${fmt(total)}.`, 'good');
      closeCard(); endTurn();
    };
    return;
  }

  // sell_type: покупатель на актив определённого типа
  const matches = S.assets.filter(a => a.kind === card.assetKind);
  if(matches.length === 0){
    const kindName = card.assetKind === 'realestate' ? 'недвижимости' : 'бизнеса';
    openCard(simpleModal('badge-market','рынок', card.title,
      `${card.desc}<br><br>Но у вас нет ${kindName} для продажи.`, 'Жаль'));
    $('#m-ok').onclick = () => { closeCard(); endTurn(); };
    return;
  }
  // список активов на продажу
  let rows = matches.map((a,i) => {
    const salePrice = Math.round(a.cost * card.profitFactor);
    const net = salePrice - (a.debt||0);
    return `<div class="deal-stat" style="grid-column:span 2; display:flex; justify-content:space-between; align-items:center">
      <div><div class="ds-l">${a.title}</div><div class="ds-v">цена ${fmt(salePrice)} → на руки ${fmt(net)}</div></div>
      <button class="btn sm primary" data-sell="${i}">Продать</button>
    </div>`;
  }).join('');
  openCard(`<div class="modal-head"><span class="deck-badge badge-market">рынок</span><h3>${card.title}</h3></div>
    <div class="modal-body"><p class="deal-desc">${card.desc} Премия к цене: ×${card.profitFactor}.</p>
    <div class="deal-stats">${rows}</div></div>
    <div class="modal-foot"><button class="btn ghost" id="mk-hold">Ничего не продавать</button></div>`);
  $('#mk-hold').onclick = () => { closeCard(); log('Рынок: оставили активы.', ''); endTurn(); };
  $('#card-modal').querySelectorAll('[data-sell]').forEach(btn => {
    btn.onclick = () => {
      const a = matches[parseInt(btn.dataset.sell)];
      const salePrice = Math.round(a.cost * card.profitFactor);
      const net = salePrice - (a.debt||0);
      S.cash += net;
      S.assets = S.assets.filter(x => x !== a);
      log(`Продано: <b>${a.title}</b> за ${fmt(salePrice)} (на руки ${fmt(net)}, поток -${fmt(a.cashflow)}).`, 'good');
      closeCard(); endTurn();
    };
  });
}

/* ---------- Благотворительность ---------- */
function cellCharity(){
  const donation = Math.round(totalIncome() * 0.10);
  const canAfford = S.cash >= donation;
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-event">благотворительность</span><h3>Помочь нуждающимся?</h3></div>
    <div class="modal-body">
      <p class="deal-desc">Пожертвуйте 10% дохода - и следующие 3 хода сможете бросать 1 или 2 кубика на выбор (быстрее двигаетесь).</p>
      <div class="deal-stats">${dealStat('Пожертвование', fmt(donation), 'neg')}${dealStat('Наличные', fmt(S.cash))}</div>
      ${canAfford?'':'<p class="modal-note" style="color:var(--red)">Недостаточно наличных.</p>'}
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="ch-no">Отказаться</button>
      <button class="btn primary" id="ch-yes" ${canAfford?'':'disabled'}>Пожертвовать ${fmt(donation)}</button>
    </div>`);
  $('#ch-no').onclick = () => { closeCard(); log('Благотворительность: отказ.', ''); endTurn(); };
  $('#ch-yes').onclick = () => {
    S.cash -= donation; S.charityTurns = 3;
    log(`Пожертвовано ${fmt(donation)}. 3 хода - выбор 1/2 кубика.`, 'gold');
    closeCard(); endTurn();
  };
}

/* ---------- Ребёнок ---------- */
function cellBaby(){
  if(S.children >= 3){
    openCard(simpleModal('badge-event','событие', 'Ребёнок',
      'У вас уже трое детей - семья в полном составе. Расходы не меняются.', 'Ок'));
    $('#m-ok').onclick = () => { closeCard(); endTurn(); };
    return;
  }
  S.children++;
  openCard(simpleModal('badge-event','прибавление', 'Пополнение в семье! 👶',
    `Поздравляем - у вас ${S.children===1?'родился первый ребёнок':'теперь '+S.children+' детей'}!
     Расходы выросли на ${fmt(S.perChild)}/мес.`, 'Ура'));
  $('#m-ok').onclick = () => { closeCard(); log(`Родился ребёнок. Расходы +${fmt(S.perChild)}/мес.`, 'bad'); endTurn(); };
}

/* ---------- Увольнение ---------- */
function cellDownsized(){
  const cost = totalExpense();
  const needLoan = S.cash < cost;
  let loanAmt = needLoan ? Math.ceil((cost - S.cash)/1000)*1000 : 0;
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-doodad">увольнение</span><h3>Вас сократили ⚠️</h3></div>
    <div class="modal-body">
      <p class="deal-desc">Потеря работы. Нужно оплатить полные месячные расходы и пропустить 2 хода.</p>
      <div class="deal-stats">${dealStat('Расходы к оплате', fmt(cost), 'neg')}${dealStat('Пропуск ходов', '2')}</div>
      ${needLoan?`<p class="modal-note" style="color:var(--red)">Не хватает - кредит ${fmt(loanAmt)}.</p>`:''}
    </div>
    <div class="modal-foot"><button class="btn primary" id="dn-ok">${needLoan?'Кредит и оплатить':'Оплатить'}</button></div>`);
  $('#dn-ok').onclick = () => {
    if(needLoan) takeBankLoan(loanAmt, true);
    S.cash -= cost; S.skipTurns = 2;
    log(`Увольнение: оплачено ${fmt(cost)}, пропуск 2 ходов.`, 'bad');
    closeCard(); endTurn();
  };
}

function simpleModal(badgeCls, badgeText, title, desc, btnText){
  return `<div class="modal-head"><span class="deck-badge ${badgeCls}">${badgeText}</span><h3>${title}</h3></div>
    <div class="modal-body"><p class="deal-desc">${desc}</p></div>
    <div class="modal-foot"><button class="btn primary" id="m-ok">${btnText}</button></div>`;
}

/* ====================================================================
   БАНКОВСКИЙ КРЕДИТ
   ==================================================================== */
function takeBankLoan(amount, silent){
  if(amount <= 0) return;
  if(!S.liabilities['Банковский кредит'])
    S.liabilities['Банковский кредит'] = { balance:0, payment:0 };
  const L = S.liabilities['Банковский кредит'];
  L.balance += amount;
  L.payment = Math.round(L.balance * LOAN_RATE);
  S.cash += amount;
  if(!silent) log(`Взят кредит ${fmt(amount)} (платёж теперь ${fmt(L.payment)}/мес).`, 'bad');
}

function openLoanModal(){
  if(busy) return;
  const L = S.liabilities['Банковский кредит'];
  const hasLoan = L && L.balance > 0;
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-event">банк</span><h3>Банковский кредит</h3></div>
    <div class="modal-body">
      <p class="deal-desc">Кредит выдаётся кратно 1000 ₽. Ежемесячный платёж - 3% от суммы долга (≈36% годовых, как потребкредит).</p>
      ${hasLoan?`<div class="deal-stats">${dealStat('Текущий долг', fmt(L.balance), 'neg')}${dealStat('Платёж/мес', fmt(L.payment))}</div>`:''}
      <div class="qty-row">
        <label>Сумма (₽):</label>
        <input type="number" id="loan-amt" value="100000" min="1000" step="1000">
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="loan-cancel">Отмена</button>
      ${hasLoan?`<button class="btn" id="loan-repay">Погасить</button>`:''}
      <button class="btn primary" id="loan-take">Взять</button>
    </div>`);
  $('#loan-cancel').onclick = () => closeCard();
  $('#loan-take').onclick = () => {
    let amt = Math.floor((parseInt($('#loan-amt').value)||0)/1000)*1000;
    if(amt < 1000){ return; }
    takeBankLoan(amt, false);
    closeCard(); render();
  };
  if(hasLoan) $('#loan-repay').onclick = () => {
    let amt = Math.floor((parseInt($('#loan-amt').value)||0)/1000)*1000;
    amt = Math.min(amt, L.balance, S.cash);
    if(amt < 1000){ log('Для погашения нужно не меньше 1000 ₽ наличными.', ''); return; }
    L.balance -= amt; S.cash -= amt;
    L.payment = Math.round(L.balance * LOAN_RATE);
    if(L.balance <= 0) delete S.liabilities['Банковский кредит'];
    log(`Погашено ${fmt(amt)} кредита.`, 'good');
    closeCard(); render();
  };
}

/* ====================================================================
   ПОБЕДА: выход из крысиных бегов
   ==================================================================== */
function checkWin(){
  if(S.won) return;
  if(isFree()){
    S.won = true;
    busy = true; render();
    const pas = passiveIncome(), exp = totalExpense();
    openCard(`
      <div class="modal win-screen">
        <div class="modal-head"><span class="deck-badge badge-small">победа</span><h3>🎉 Выход из крысиных бегов!</h3></div>
        <div class="modal-body">
          <div class="win-big">🏁</div>
          <p class="deal-desc">Ваш пассивный доход (${fmt(pas)}/мес) покрыл расходы (${fmt(exp)}/мес).
            Вы больше не зависите от зарплаты - можно выходить на скоростную дорожку!</p>
          <p class="modal-note">Скоростная дорожка (Fast Track) - в следующей итерации.
            Пока можно продолжить наращивать поток в крысиных бегах.</p>
        </div>
        <div class="modal-foot"><button class="btn primary" id="win-continue">Продолжить игру</button></div>
      </div>`);
    log('🎉 ПОБЕДА! Пассивный доход покрыл расходы - выход из крысиных бегов!', 'gold');
    $('#win-continue').onclick = () => { closeCard(); busy = false; render(); };
  }
}

/* ====================================================================
   СОВЕТНИК (контекстные подсказки в духе Кийосаки)
   ==================================================================== */
function advisorTip(inc, exp, pas, cf){
  const gap = exp - pas;
  const L = S.liabilities['Банковский кредит'];
  // приоритет: критичные состояния → потом обучающие
  if(cf < 0)
    return 'Денежный поток <b>отрицательный</b> - расходы выше дохода. Гаси дорогие долги и не бери новых пассивов.';
  if(L && L.balance > 0)
    return `На тебе банковский кредит ${fmt(L.balance)} под 3%/мес - это якорь. Гаси его в первую очередь (кнопка «Взять кредит»).`;
  if(pas <= 0)
    return 'Пока твои деньги не работают. Купи первый <b>актив</b> с потоком: вклад, ОФЗ, дивидендные акции или малый бизнес.';
  if(S.cash > 1500000)
    return `На руках ${fmt(S.cash)} лежат без дела. Деньги должны работать - вложи их в актив, дающий поток.`;
  if(gap <= 0)
    return 'Пассивный доход уже покрывает расходы - ты свободен! Можно выходить из крысиных бегов.';
  if(gap < exp * 0.25)
    return `Ты почти у цели! До выхода - всего ${fmt(gap)}/мес пассивного потока. Ещё пара активов - и свобода.`;
  if(pas < exp * 0.5)
    return `Хорошее начало: пассивный ${fmt(pas)} из ${fmt(exp)}. Сравнивай сделки по доходности и бери активы с потоком, а не пассивы.`;
  return `Держи курс: каждый новый актив приближает выход. Осталось закрыть ${fmt(gap)}/мес пассивным доходом.`;
}

/* ====================================================================
   СПРАВКА (принципы Кийосаки)
   ==================================================================== */
function openHelp(){
  const secs = HELP_SECTIONS.map(s => `<div class="help-sec"><h4>${s.h}</h4><p>${s.p}</p></div>`).join('');
  openCard(`
    <div class="modal-head"><span class="deck-badge badge-small">справка</span><h3>Как победить: принципы Кийосаки</h3></div>
    <div class="modal-body">${secs}</div>
    <div class="modal-foot"><button class="btn primary" id="help-close">Понятно, играем</button></div>`);
  $('#card-modal').classList.add('help-modal');
  $('#help-close').onclick = () => closeCard();
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
  $('#btn-loan').onclick = openLoanModal;

  $('#btn-restart').onclick = () => {
    if(confirm('Начать новую игру? Текущий прогресс будет сброшен.')){
      clearSave(); S = null; selectedProf = null;
      $('#game-view').style.display = 'none';
      $('#btn-start').disabled = true; $('#start-note').textContent = 'Профессия не выбрана';
      document.querySelectorAll('.prof-card').forEach(c=>c.classList.remove('sel'));
      $('#start-overlay').classList.add('show');
    }
  };
  $('#btn-reset').onclick = () => {
    if(confirm('Полный сброс сохранения?')){ clearSave(); location.reload(); }
  };

  // загрузка сохранённой игры
  const saved = loadSave();
  if(saved && saved.prof){
    S = saved;
    if(!S.marketPrices) S.marketPrices = {};
    busy = false;
    $('#start-overlay').classList.remove('show');
    $('#game-view').style.display = 'grid';
    render();
    log('Игра загружена из сохранения.', 'info');
  }
}

document.addEventListener('DOMContentLoaded', init);
