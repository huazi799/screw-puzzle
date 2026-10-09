// 调试：引擎轨迹 vs 求解器模型回放（第 N 关，N=argv[2]）
global.localStorage = {
  _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); },
};
const fs = require('fs');
const path = require('path');
let src = ['rng', 'audio', 'levels', 'game']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'))
  .join('\n')
  .replace(/\r\n/g, '\n');
src = src.replace('return { get, PlateShapes };', 'return { get, PlateShapes, trySolve };');
const { Levels, Game } = new Function(src + '\nreturn { Levels, Game };')();

const l = +(process.argv[2] || 6);
const CAP = 5;
Game.loadLevel(l);
const levelData = {
  plates: Game.plates.map(p => ({
    cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot, z: p.z, shape: p.shape,
    holes: p.screws.map(s => ({ lx: s.lx, ly: s.ly, color: s.color })),
  })),
  nColors: 5,
};
const order = Levels.trySolve(levelData);
if (!order) { console.log('无解'); process.exit(1); }
const colors = [];
levelData.plates.forEach(p => p.holes.forEach(h => colors.push(h.color)));
console.log(`第${l}关 顺序: ${order.map(i => colors[i]).join(',')}`);

// —— 引擎轨道 ——
Game.loadLevel(l); // 复位
const engineStates = [];
{
  const snap = (i, note) => engineStates.push({
    i, note,
    b1: `${Game.boxes[0].color},${Game.boxes[0].filled}`,
    b2: `${Game.boxes[1].color},${Game.boxes[1].filled}`,
    spare: Game.queue.filter(e => e.dest === 'spare' && e.state !== 'popping').map(e => e.color).join(''),
    spareN: Game.queue.filter(e => e.dest === 'spare' && e.state !== 'popping').length,
    state: Game.state,
  });
  snap(-1, '开局');
  for (let i = 0; i < order.length; i++) {
    const si = order[i];
    let acc = 0, p = null, s = null;
    for (const pl of Game.plates) {
      if (si < acc + pl.screws.length) { p = pl; s = pl.screws[si - acc]; break; }
      acc += pl.screws.length;
    }
    if (s.removed) { engineStates.push({ i, note: '已拆?' }); break; }
    const w = Game.screwWorld(p, s);
    Game.unscrew(p, s);
    snap(i, '');
    if (Game.state !== 'playing') break;
  }
}

// —— 求解器模型轨道（镜像 levels.js 的 settle 链）——
const modelStates = [];
{
  const plates = levelData.plates;
  const nColors = 5;
  const screws = [];
  plates.forEach(p => p.holes.forEach(h => screws.push(h.color)));
  const plateMask = plates.map((p, pi) => {
    let m = 0;
    p.holes.forEach((_, k) => { m |= (1 << (offsets(pi) + k)); });
    return m >>> 0;
  });
  function offsets(pi) { let a = 0; for (let i = 0; i < pi; i++) a += plates[i].holes.length; return a; }
  function popcount(v) {
    v = v - ((v >> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
    v = (v + (v >> 4)) & 0x0F0F0F0F;
    return (v * 0x01010101) >> 24;
  }
  function covers(qi, mask) { return popcount(mask & plateMask[qi]) > 1; }
  function boardCounts(mask) {
    const r = {};
    for (let si = 0; si < screws.length; si++) if (mask & (1 << si)) r[screws[si]] = (r[screws[si]] || 0) + 1;
    return r;
  }
  function assignFor(bi, mask, spare, boxes) {
    const remaining = boardCounts(mask);
    for (let c = 0; c < nColors; c++) if (spare[c] > 0) remaining[c] = (remaining[c] || 0) + spare[c];
    let keys = Object.keys(remaining).map(Number).sort((a, b) => a - b);
    const other = boxes[1 - bi];
    if (other && other.color >= 0) {
      const f = keys.filter(c => c !== other.color);
      if (f.length) keys = f;
    }
    if (!keys.length) return -1;
    const full = keys.filter(c => remaining[c] >= 3);
    const pool = full.length ? full : keys;
    let best = pool[0], bestN = -1;
    for (const c of pool) if (spare[c] > bestN) { best = c; bestN = spare[c]; }
    return best;
  }
  function flowInto(bi, mask, spare, boxes) {
    const b = boxes[bi];
    while (b.color >= 0 && b.filled < 3 && spare[b.color] > 0) {
      const t = Math.min(3 - b.filled, spare[b.color]);
      spare[b.color] -= t;
      b.filled += t;
      if (b.filled === 3) {
        b.color = assignFor(bi, mask, spare, boxes);
        b.filled = 0;
        if (b.color < 0) return;
      }
    }
  }
  function heal(bi, mask, spare, boxes) {
    const b = boxes[bi];
    if (b.color < 0 || b.filled === 0) return;
    const bc = boardCounts(mask);
    if (bc[b.color] > 0) return;
    spare[b.color] = (spare[b.color] || 0) + b.filled;
    b.filled = 0;
    b.color = assignFor(bi, mask, spare, boxes);
    flowInto(bi, mask, spare, boxes);
  }
  function settle(bi, mask, spare, boxes) {
    if (bi >= 0) flowInto(bi, mask, spare, boxes);
    flowInto(0, mask, spare, boxes);
    flowInto(1, mask, spare, boxes);
    heal(0, mask, spare, boxes);
    heal(1, mask, spare, boxes);
  }

  const mSpare = new Array(nColors).fill(0);
  const b1 = { color: -1, filled: 0 }, b2 = { color: -1, filled: 0 };
  b1.color = assignFor(0, ((1 << screws.length) - 1) >>> 0, mSpare, [b1, b2]);
  b2.color = assignFor(1, ((1 << screws.length) - 1) >>> 0, mSpare, [b1, b2]);
  let mask = ((1 << screws.length) - 1) >>> 0;
  const snap = (i, note) => modelStates.push({
    i, note,
    b1: `${b1.color},${b1.filled}`,
    b2: `${b2.color},${b2.filled}`,
    spare: mSpare.map((v, c) => v > 0 ? String(c).repeat(v) : '').join(''),
    spareN: mSpare.reduce((a, b) => a + b, 0),
  });
  snap(-1, '开局');
  for (let i = 0; i < order.length; i++) {
    const c = screws[order[i]];
    let t = -1;
    if (b1.color === c && b1.filled < 3) t = 0;
    else if (b2.color === c && b2.filled < 3) t = 1;
    if (t >= 0) {
      const b = t === 0 ? b1 : b2;
      b.filled++;
      if (b.filled === 3) settle(t, mask, mSpare, [b1, b2]);
    } else {
      mSpare[c] = (mSpare[c] || 0) + 1;
    }
    mask &= ~(1 << order[i]);
    settle(-1, mask, mSpare, [b1, b2]);
    snap(i, '');
    if (mSpare.reduce((a, b) => a + b, 0) >= CAP) { modelStates.push({ i, note: '模型备选爆' }); break; }
  }
}

for (let i = 0; i < Math.max(engineStates.length, modelStates.length); i++) {
  const e = engineStates[i] || {};
  const m = modelStates[i] || {};
  const same = e.b1 === m.b1 && e.b2 === m.b2 && e.spare === m.spare;
  console.log(`click${i}${same ? '' : ' ←分歧!'} 引擎[盒1(${e.b1 ?? '-'}) 盒2(${e.b2 ?? '-'}) 备${e.spare ?? '-'}${e.note ? ' ' + e.note : ''}] 模型[盒1(${m.b1 ?? '-'}) 盒2(${m.b2 ?? '-'}) 备${m.spare ?? '-'}${m.note ? ' ' + m.note : ''}]`);
}
function offsets(pi) { let a = 0; for (let i = 0; i < pi; i++) a += levelData.plates[i].holes.length; return a; }
