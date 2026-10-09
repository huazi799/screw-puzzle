// 回归测试：加载真实游戏引擎（game.js），按求解器给出的顺序逐一点击螺丝，
// 验证双盒机制下 1~40 关全部可通关。引擎即规则，不存在第二份模拟。
global.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = String(v); },
};
const fs = require('fs');
const path = require('path');

let src = ['rng', 'audio', 'levels', 'game']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'))
  .join('\n')
  .replace(/\r\n/g, '\n');
src = src.replace('return { get, PlateShapes };', 'return { get, PlateShapes, trySolve };');
const { Levels, Game } = new Function(src + '\nreturn { Levels, Game };')();

// 关卡包：与玩家加载同一批关卡；版本不匹配则要求重新生成
const packPath = path.join(__dirname, '..', 'js', 'generated-levels.js');
if (fs.existsSync(packPath)) {
  const packSrc = fs.readFileSync(packPath, 'utf8').replace('window.GeneratedLevels', 'globalThis.GeneratedLevels');
  const packV = +(packSrc.match(/"v": (\d+)/) || [])[1] || 0;
  const srcGenV = +(src.match(/GEN_VERSION = (\d+)/) || [])[1] || 0;
  if (packV !== srcGenV) {
    console.log(`关卡包过期（包 v${packV} ≠ 代码 v${srcGenV}）：请重跑 node test/generate-pack.js`);
    process.exit(2);
  }
  new Function(packSrc)();
}

const CAP = 5;
let bad = 0;
let worstSpare = 0;
let slowest = 0;

for (let l = 1; l <= 40; l++) {
  const t0 = Date.now();
  Game.loadLevel(l);
  const levelData = {
    plates: Game.plates.map(p => ({
      cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot, z: p.z, shape: p.shape,
      holes: p.screws.map(s => ({ lx: s.lx, ly: s.ly, color: s.color })),
    })),
    nColors: 5,
  };
  const order = Levels.trySolve(levelData);
  if (!order) { console.log(`第${l}关 双盒规则下无解! (${Date.now() - t0}ms)`); bad++; continue; }

  // 平铺索引 → 板/螺丝映射
  const off = []; const plateOf = [];
  Game.plates.reduce((a, p, pi) => { off[pi] = a; p.screws.forEach(() => plateOf.push(pi)); return a + p.screws.length; }, 0);

  let maxSpare = 0, lost = false, mismatch = false, divClick = -1, divWhat = '';
  for (let i = 0; i < order.length; i++) {
    const si = order[i];
    const pi = plateOf[si];
    const p = Game.plates[pi];
    const s = p.screws[si - off[pi]];
    if (s.removed) { mismatch = true; divClick = i; divWhat = '螺丝已被拆'; break; }
    const w = Game.screwWorld(p, s);
    // 遮挡模型一致性：求解器认为可点 ⇔ 引擎认定未被压住
    if (Game.blockingPlate(w.x, w.y, p.z)) { mismatch = true; divClick = i; divWhat = '引擎判定被遮挡'; break; }
    if (Game.state !== 'playing') { lost = true; break; }
    Game.unscrew(p, s); // 直接执行（绕过点击命中半径的几何歧义）
    // 备选格占用不得超过 4（第 5 格必须伴随盒内消除，否则判负）
    const spareN = Game.queue.filter(e => e.dest === 'spare' && e.state !== 'popping').length;
    maxSpare = Math.max(maxSpare, spareN);
    if (spareN > 4) { lost = true; divClick = i; divWhat = '备选格超上界'; break; }
    if (Game.state === 'lost') { lost = true; divClick = i; divWhat = '引擎判负'; break; }
  }
  worstSpare = Math.max(worstSpare, maxSpare);
  const genMs = Date.now() - t0;
  slowest = Math.max(slowest, genMs);

  if (lost || mismatch) { console.log(`第${l}关 失败@click${divClick} ${divWhat} 最多备选${maxSpare}`); bad++; continue; }
  for (let i = 0; i < 60; i++) Game.update(1 / 60); // 结算胜利
  if (Game.state !== 'won') { console.log(`第${l}关 未进入胜利结算 state=${Game.state}`); bad++; continue; }
  if (l <= 10 || genMs > 200) {
    console.log(`第${l}关 OK 最多备选 ${maxSpare}/${CAP} 耗时 ${genMs}ms`);
  }
}
console.log(bad === 0
  ? `\n40 关在真实引擎下全部可通关；备选格最大占用 ${worstSpare}/${CAP}；单关最慢 ${slowest}ms`
  : `\n${bad} 关存在问题`);
process.exit(bad === 0 ? 0 : 1);
