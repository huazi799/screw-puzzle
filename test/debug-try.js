// 诊断 trySolve 调用
global.localStorage = {
  _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = String(v); },
};
const fs = require('fs');
const path = require('path');
let src = ['rng', 'audio', 'levels', 'game']
  .map(f => fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'))
  .join('\n');
const hit = src.includes('return { get, PlateShapes };');
src = src.replace('return { get, PlateShapes };', 'return { get, PlateShapes, trySolve };');
const { Levels, Game } = new Function(src + '\nreturn { Levels, Game };')();
console.log('patch命中:', hit, ' trySolve类型:', typeof Levels.trySolve);
Game.loadLevel(6);
const levelData = {
  plates: Game.plates.map(p => ({
    cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot, z: p.z, shape: p.shape,
    holes: p.screws.map(s => ({ lx: s.lx, ly: s.ly, color: s.color })),
  })),
  nColors: 5,
};
const r = Levels.trySolve(levelData);
console.log('trySolve返回:', r === null ? 'null' : typeof r, r && r.order ? 'order=' + r.order.length : JSON.stringify(r));
