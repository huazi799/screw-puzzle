// 关卡生成器 + 可解性求解器
// 布局：竖向堆叠的板（z 越大越靠上层），上层板会盖住下层板的螺丝。
// 每关由关卡号确定性生成（同号必同图），并且经过求解器验证一定有解。
const Levels = (() => {
  const FIELD = { left: 28, right: 362, top: 130, bottom: 592 };
  const HOLE_GAP = 56;     // 孔与孔的最小间距
  const COVER_MARGIN = 10; // 判定“被盖住”时形状的外扩量（须与 game.js 一致）
  const CAPACITY = 5;      // 槽位容量（须与 game.js 一致）

  // 6 种板形状：0 圆角矩形 / 1 椭圆 / 2 方圆(squircle) / 3 四瓣花 / 4 心形 / 5 六边形
  // inside() 供遮挡判定与孔位采样使用；outline() 供渲染采样轮廓点，两者基于同一套数学
  const PlateShapes = {
    COUNT: 6,
    test(shape, lx, ly, w, h) {
      const u = (lx * 2) / w, v = (ly * 2) / h; // 归一化到 [-1,1]
      switch (shape) {
        case 1: // 椭圆
          return u * u + v * v <= 1;
        case 2: { // 方圆 |u|³+|v|³≤1
          const au = Math.abs(u), av = Math.abs(v);
          return au * au * au + av * av * av <= 1;
        }
        case 3: { // 四瓣花：极径 0.8+0.2cos4θ
          const t = Math.sqrt(u * u + v * v);
          if (t > 1) return false;
          const lim = 0.8 + 0.2 * Math.cos(4 * Math.atan2(v, u));
          return t <= lim;
        }
        case 4: { // 心形（隐式曲线，Y 轴向上）
          const HT = 1.27, HB = 1.0, HA = 1.13;
          const Xu = u * HA;
          const Yu = HT - (v + 1) * ((HT + HB) / 2);
          const q = Xu * Xu + Yu * Yu - 1;
          return q * q * q - Xu * Xu * Yu * Yu * Yu <= 0;
        }
        case 5: { // 六边形（点顶）
          const pts = [];
          for (let i = 0; i < 6; i++) {
            const a = Math.PI / 3 * i + Math.PI / 6;
            pts.push([Math.cos(a), Math.sin(a)]);
          }
          for (let i = 0; i < 6; i++) {
            const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % 6];
            const cross = (x2 - x1) * (ly / (h / 2) - y1) - (y2 - y1) * (lx / (w / 2) - x1);
            if (cross < 0) return false;
          }
          return true;
        }
        default: // 圆角矩形
          return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
      }
    },
    inside(shape, lx, ly, w, h, margin) {
      if (!margin) return this.test(shape, lx, ly, w, h);
      // 近似外扩 margin：中心或四个轴向偏移点落在形状内即可
      return this.test(shape, lx, ly, w, h) ||
        this.test(shape, lx + margin, ly, w, h) ||
        this.test(shape, lx - margin, ly, w, h) ||
        this.test(shape, lx, ly + margin, w, h) ||
        this.test(shape, lx, ly - margin, w, h);
    },
    // 渲染用轮廓点（shape 0 由渲染层自己走圆角矩形路径）
    outline(shape, w, h, n) {
      const pts = [];
      const hw = w / 2, hh = h / 2;
      if (shape === 1) {
        for (let i = 0; i < n; i++) {
          const a = Math.PI * 2 * i / n;
          pts.push([hw * Math.cos(a), hh * Math.sin(a)]);
        }
      } else if (shape === 2) {
        for (let i = 0; i < n; i++) {
          const a = Math.PI * 2 * i / n;
          const c = Math.cos(a), s = Math.sin(a);
          pts.push([hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / 3),
                    hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / 3)]);
        }
      } else if (shape === 3) {
        for (let i = 0; i < n; i++) {
          const a = Math.PI * 2 * i / n;
          const r = 0.8 + 0.2 * Math.cos(4 * a);
          pts.push([hw * r * Math.cos(a), hh * r * Math.sin(a)]);
        }
      } else if (shape === 4) {
        const HT = 1.27, HB = 1.0, HA = 1.13, HYC = (HT - HB) / 2;
        for (let i = 0; i < n; i++) {
          const a = Math.PI * 2 * i / n;
          // 从形心 (0, HYC) 沿方向二分求隐式曲线边界
          let lo = -1.7, hi = 1.7;
          const f = (r) => {
            const Xu = r * Math.cos(a);
            const Yu = HYC + r * Math.sin(a);
            const q = Xu * Xu + Yu * Yu - 1;
            return q * q * q - Xu * Xu * Yu * Yu * Yu;
          };
          for (let k = 0; k < 24; k++) {
            const mid = (lo + hi) / 2;
            if (f(mid) < 0) lo = mid; else hi = mid;
          }
          const Xu = lo * Math.cos(a), Yu = HYC + lo * Math.sin(a);
          pts.push([(Xu / HA) * hw, ((HT - Yu) * (h / (HT + HB))) - hh]);
        }
      } else if (shape === 5) {
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 3 * i + Math.PI / 6;
          pts.push([hw * Math.cos(a), hh * Math.sin(a)]);
        }
      }
      return pts;
    },
  };

  // 旋转后矩形的包围半宽/半高，用于把板约束在场地内
  function rotAabb(w, h, rot) {
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    return { ex: (w * c + h * s) / 2, ey: (w * s + h * c) / 2 };
  }

  // 在板上采一个与已有孔保持间距、且整体落在板形状内的新孔
  function addHole(p, rng) {
    const m = 8;
    for (let t = 0; t < 300; t++) {
      const lx = rng.range(-(p.w / 2 - m), p.w / 2 - m);
      const ly = rng.range(-(p.h / 2 - m), p.h / 2 - m);
      if (!PlateShapes.inside(p.shape, lx, ly, p.w, p.h, 26)) continue;
      if (p.holes.every(o => Math.hypot(o.lx - lx, o.ly - ly) >= HOLE_GAP)) {
        p.holes.push({ lx, ly, color: 0 });
        return true;
      }
    }
    return false;
  }

  // 每种颜色的螺丝总数必须是 3 的倍数，且 ≤ 3×颜色数（由配额保证）
  function fixColors(plates, nColors, rng) {
    const total = () => plates.reduce((a, p) => a + p.holes.length, 0);
    let T = total();

    // 总螺丝数限制在求解器位运算舒适的范围内
    while (T > 27) {
      const cand = plates.filter(p => p.holes.length > 2)
        .sort((a, b) => b.holes.length - a.holes.length)[0];
      if (!cand) break;
      cand.holes.pop();
      T = total();
    }
    // 调整到 3 的倍数：优先删（板保底 2 孔），删不动就补——一次算好执行量，避免逐轮重判来回抖动
    const need = 3 * nColors;
    const removableStock = plates
      .reduce((a, p) => a + Math.max(0, p.holes.length - 2), 0);
    const remDelta = T % 3;
    const addDelta = (3 - T % 3) % 3;
    if (remDelta > 0 && T - remDelta >= need && removableStock >= remDelta) {
      for (let i = 0; i < remDelta; i++) {
        const cand = plates.filter(p => p.holes.length > 2)
          .sort((a, b) => b.holes.length - a.holes.length)[0];
        cand.holes.pop();
      }
    } else if (addDelta > 0) {
      for (let i = 0; i < addDelta; i++) {
        const cand = plates.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
        if (!addHole(cand, rng)) {
          cand.holes.push({ lx: rng.range(-8, 8), ly: rng.range(-8, 8), color: 0 });
        }
      }
    }
    // 保证每种颜色至少能凑一组三消
    T = total();
    let guard = 0;
    while (T < need && guard++ < 60) {
      const cand = plates.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
      if (!addHole(cand, rng)) {
        cand.holes.push({ lx: rng.range(-8, 8), ly: rng.range(-8, 8), color: 0 });
      }
      T = total();
    }
    // 先定每色配额（均为 3 的倍数），再把配额发到随机打乱的孔位上
    const buckets = new Array(nColors).fill(3);
    let rest = T - nColors * 3;
    while (rest > 0) { buckets[rng.int(0, nColors - 1)] += 3; rest -= 3; }
    const holes = plates.reduce((a, p) => (a.push(...p.holes), a), []);
    rng.shuffle(holes);
    let i = 0;
    for (let c = 0; c < nColors; c++)
      for (let j = 0; j < buckets[c]; j++) holes[i++].color = c;
  }

  function genLayout(levelNo, rng) {
    // 板更多、更大、纵向更密——上层板要拆到掉落才能露出里层
    const nPlates = Math.min(4 + Math.floor((levelNo - 1) / 2), 10);
    const nColors = Math.min(3 + Math.floor((levelNo - 1) / 4), 5);
    const plates = [];
    const spreadTop = FIELD.top + (FIELD.bottom - FIELD.top) * 0.1;
    const spreadBot = FIELD.bottom - (FIELD.bottom - FIELD.top) * 0.1;
    const slotH = (spreadBot - spreadTop) / nPlates;
    let lastColor = -1;
    for (let z = 0; z < nPlates; z++) {
      const shrink = 1 - (z / Math.max(1, nPlates - 1)) * 0.25; // 越靠上越小
      const w = Math.round(rng.range(165, 232) * shrink);
      const h = Math.round(rng.range(105, 150) * shrink);
      const rot = rng.pick([0, 10, -10, 18, -18, 28, -28, 40, -40]) * Math.PI / 180;
      const ab = rotAabb(w, h, rot);
      const cx = rng.range(FIELD.left + ab.ex, FIELD.right - ab.ex);
      const cy = Math.max(FIELD.top + ab.ey, Math.min(FIELD.bottom - ab.ey,
        spreadTop + slotH * (z + 0.5) + rng.range(-slotH * 0.24, slotH * 0.24)));
      // 前 2 关以规整形状为主，之后 6 种全开；相邻板颜色错开
      const shape = levelNo < 3 ? rng.pick([0, 0, 1, 2]) : rng.int(0, PlateShapes.COUNT - 1);
      lastColor = (lastColor + 1 + rng.int(0, 4)) % 6;
      const p = { cx, cy, w, h, rot, z, shape, pcolor: lastColor, holes: [] };
      let kMax = 2;
      if (rng() < 0.55) kMax++;
      if (levelNo >= 6 && rng() < 0.4) kMax++;
      if (levelNo >= 15 && rng() < 0.35) kMax++;
      for (let k = 0; k < kMax; k++) addHole(p, rng);
      plates.push(p);
    }
    fixColors(plates, nColors, rng);
    return { plates, nColors };
  }

  // 兜底布局：3 块互不遮挡的板、6 颗螺丝、2 色
  function simpleLayout(rng) {
    const plates = [];
    for (let z = 0; z < 3; z++) {
      const p = { cx: 195 + rng.range(-30, 30), cy: 200 + z * 150, w: 190, h: 110,
        rot: rng.pick([0, 10, -10]) * Math.PI / 180, z, shape: z % 3, pcolor: z % 6, holes: [] };
      addHole(p, rng); addHole(p, rng);
      plates.push(p);
    }
    fixColors(plates, 2, rng);
    return { plates, nColors: 2 };
  }

  // 双盒规则求解：返回螺丝拆除顺序（索引数组），无解返回 null。
  // 状态 = (剩余螺丝位掩码, 备选格各色数量, 两个盒子各自的盒色与盒内数量)。
  // 规则与 game.js 逐步对应：
  //   路由：匹配盒1优先、其次盒2、否则进备选格（总数达 CAPACITY-1 后再加即败）；
  //   流转：备选格中与盒同色的螺丝自动流入盒子；盒满即完成：按确定性规则开新盒并再次流转（可连锁）；
  //   自愈：某盒颜色在板载中剩 0 且盒内还有螺丝 → 螺丝退回备选格并重选颜色。
  function trySolve(level) {
    const plates = level.plates;
    const screws = [];
    plates.forEach((p, pi) => {
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      p.holes.forEach(hl => screws.push({
        pi, color: hl.color,
        wx: p.cx + hl.lx * c - hl.ly * s,
        wy: p.cy + hl.lx * s + hl.ly * c,
      }));
    });
    const N = screws.length;
    if (N < 3 || N > 30) return null;

    const plateMask = plates.map((p, pi) => {
      let m = 0;
      for (let si = 0; si < N; si++) if (screws[si].pi === pi) m |= (1 << si);
      return m >>> 0;
    });
    // coverBy[q][si]：板 q 是否盖住螺丝 si（只在 q 层级更高且未掉落时生效），按形状判定
    const coverBy = plates.map(q => {
      const c = Math.cos(q.rot), s = Math.sin(q.rot);
      return screws.map(sc => {
        if (plates[sc.pi].z >= q.z) return false;
        const dx = sc.wx - q.cx, dy = sc.wy - q.cy;
        const lx = dx * c + dy * s, ly = -dx * s + dy * c;
        return PlateShapes.inside(q.shape, lx, ly, q.w, q.h, COVER_MARGIN);
      });
    });

    const nColors = level.nColors;
    const failed = new Set();
    let visits = 0;
    const VISIT_CAP = 100000;

    // 剩 ≤1 颗螺丝的板已被"吊起"，是挂不是压——不参与遮挡（与 game.js blockingPlate 一致）
    function popcount(v) {
      v = v - ((v >> 1) & 0x55555555);
      v = (v & 0x33333333) + ((v >> 2) & 0x33333333);
      v = (v + (v >> 4)) & 0x0F0F0F0F;
      return (v * 0x01010101) >> 24;
    }
    function covers(qi, mask) {
      return popcount(mask & plateMask[qi]) > 1;
    }

    function boardCounts(mask) {
      const r = {};
      for (let si = 0; si < N; si++) {
        if (mask & (1 << si)) r[screws[si].color] = (r[screws[si].color] || 0) + 1;
      }
      return r;
    }

    // 可点（未被压住）的某色螺丝数——开盒评分用（与 game.js clickableCount 一致）
    function clickableCount(mask, color) {
      let n = 0;
      for (let si = 0; si < N; si++) {
        if (!(mask & (1 << si)) || screws[si].color !== color) continue;
        let covered = false;
        for (let q = 0; q < plates.length; q++) {
          if (!covers(q, mask)) continue;
          if (coverBy[q][si]) { covered = true; break; }
        }
        if (!covered) n++;
      }
      return n;
    }

    // 与 game.js 的 assignBox 完全一致：避开另一盒颜色（有其他选择时），
    // 只选剩余（板载+备选）≥ 3 的颜色（保证该盒能凑满、末局刚好契合），
    // 评分 = 备选格存量×10 + 可点数量，并列取最小色号
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
      for (const c of pool) {
        const score = spare[c] * 10 + clickableCount(mask, c);
        if (score > bestN) { best = c; bestN = score; }
      }
      return best;
    }

    // 备选格同色流入盒子；盒满即完成（重选颜色 + 继续流转，可连锁）
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

    // 自愈：盒色在板载与备选格中都已为 0 且盒内还有螺丝（永远凑不齐）→ 退回备选格并重选颜色。
    // 条件与 game.js 的 healStuckBoxes 一致（remaining = 板载 + 备选格）。
    function heal(bi, mask, spare, boxes) {
      const b = boxes[bi];
      if (b.color < 0 || b.filled === 0) return;
      const bc = boardCounts(mask);
      const total = (bc[b.color] || 0) + (spare[b.color] || 0);
      if (total > 0) return;
      spare[b.color] = (spare[b.color] || 0) + b.filled;
      b.filled = 0;
      b.color = assignFor(bi, mask, spare, boxes);
      flowInto(bi, mask, spare, boxes);
    }

    // 一步点击后的结算（顺序与 game.js unscrew 严格一致：完成吸入 → flowBoxes → healStuckBoxes）
    function settle(bi, mask, spare, boxes) {
      if (bi >= 0) flowInto(bi, mask, spare, boxes); // 完成盒子的吸入
      flowInto(0, mask, spare, boxes); // flowBoxes
      flowInto(1, mask, spare, boxes);
      heal(0, mask, spare, boxes);     // healStuckBoxes
      heal(1, mask, spare, boxes);
    }

    function dfs(mask, spare, b1, b2) {
      if (mask === 0) return [];
      if (visits++ > VISIT_CAP) return null;
      const spareTotal = spare.reduce((a, b) => a + b, 0);
      const moves = [];
      for (let si = 0; si < N; si++) {
        if (!(mask & (1 << si))) continue;
        let covered = false;
        for (let q = 0; q < plates.length; q++) {
          if (!covers(q, mask)) continue; // 板已掉或已被吊起（剩≤1颗）
          if (coverBy[q][si]) { covered = true; break; }
        }
        if (covered) continue;
        const c = screws[si].color;
        // 路由：匹配盒1优先，其次盒2，都不匹配进备选格
        let toBox = -1;
        if (b1.color === c && b1.filled < 3) toBox = 0;
        else if (b2.color === c && b2.filled < 3) toBox = 1;
        if (toBox < 0 && spareTotal >= CAPACITY - 1) continue; // 备选格再加一格就满（满 = 败）
        const plateLast = (plateMask[screws[si].pi] & mask) === (1 << si);
        let score = 0;
        if (toBox >= 0) {
          const bf = toBox === 0 ? b1.filled : b2.filled;
          if (bf === 2) score += 1000; // 完成盒子
          score += 100;                // 优先喂盒子
        }
        if (plateLast) score += 500;   // 拆完一块板
        score += spare[c] * 5;
        score += plates[screws[si].pi].z;
        moves.push({ si, c, toBox, score });
      }
      moves.sort((a, b) => b.score - a.score);
      for (const mv of moves) {
        const nm = (mask & ~(1 << mv.si)) >>> 0;
        const ns = spare.slice();
        const nb1 = { color: b1.color, filled: b1.filled };
        const nb2 = { color: b2.color, filled: b2.filled };
        if (mv.toBox >= 0) {
          const nb = mv.toBox === 0 ? nb1 : nb2;
          nb.filled++;
          if (nb.filled === 3) settle(mv.toBox, nm, ns, [nb1, nb2]);
        } else {
          ns[mv.c]++;
        }
        settle(-1, nm, ns, [nb1, nb2]); // 流转 + 自愈（与 game.js 的 flowBoxes/healStuckBoxes 对应）
        const key = nm + '|' + ns.join(',') + '|' + nb1.color + ',' + nb1.filled + '|' + nb2.color + ',' + nb2.filled;
        if (failed.has(key)) continue;
        const rest = dfs(nm, ns, nb1, nb2);
        if (rest) { rest.unshift(mv.si); return rest; }
      }
      failed.add(mask + '|' + spare.join(',') + '|' + b1.color + ',' + b1.filled + '|' + b2.color + ',' + b2.filled);
      return null;
    }

    const fullMask = ((1 << N) - 1) >>> 0;
    const initSpare = new Array(nColors).fill(0);
    const c1 = assignFor(0, fullMask, initSpare, [{ color: -1, filled: 0 }, { color: -1, filled: 0 }]);
    const c2 = assignFor(1, fullMask, initSpare, [{ color: c1, filled: 0 }, { color: -1, filled: 0 }]);
    return dfs(fullMask, initSpare, { color: c1, filled: 0 }, { color: c2, filled: 0 });
  }

  const GEN_VERSION = 21; // 改动生成/求解逻辑时递增（与 index.html 脚本版本同步），用于失效旧缓存与旧关卡包

  function get(levelNo) {
    // 1) 预生成关卡包（test/generate-pack.js 产出 js/generated-levels.js）：命中则零耗时
    if (typeof GeneratedLevels !== 'undefined' && GeneratedLevels && GeneratedLevels.v === GEN_VERSION) {
      const hit = GeneratedLevels.levels[levelNo];
      if (hit) return hit;
    }
    // 2) 运行时缓存（localStorage）：本会话/历史生成过的关卡
    const cacheKey = 'sp_gen' + GEN_VERSION + '_' + levelNo;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const lv = JSON.parse(cached);
        if (lv && lv.plates && lv.plates.length) return lv;
      }
    } catch (e) {}
    for (let attempt = 0; attempt < 50; attempt++) {
      const rng = makeRng(levelNo * 7919 + attempt * 104729 + 11);
      const lv = genLayout(levelNo, rng);
      if (trySolve(lv)) { cache(lv, cacheKey); return lv; }
    }
    for (let attempt = 0; attempt < 200; attempt++) {
      const lv = simpleLayout(makeRng(12345 + attempt * 77));
      if (trySolve(lv)) { cache(lv, cacheKey); return lv; }
    }
    const fallback = simpleLayout(makeRng(1)); // 理论上到不了这里
    return fallback;
  }

  function cache(lv, key) {
    try { localStorage.setItem(key, JSON.stringify(lv)); } catch (e) {}
  }

  return { get, PlateShapes };
})();
