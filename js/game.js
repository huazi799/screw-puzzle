// 核心玩法逻辑（逻辑坐标系固定 390×740，渲染见 render.js）
const Store = {
  get(k, d) {
    try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }
    catch (e) { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const Game = {
  VW: 390, VH: 740,
  MAX_CAPACITY: 7,
  capacity: 5,
  SLOT_Y: 682,
  slotX(i) {
    const n = this.capacity || 5;
    const spacing = Math.min(62, 300 / n);
    return 195 + (i - (n - 1) / 2) * spacing;
  },
  restartBtn: { x: 42, y: 35, r: 24 },
  propButtons: [
    { id: 'add', x: 75, y: 600, w: 110, h: 38 },
    { id: 'clear', x: 205, y: 600, w: 110, h: 38 },
  ],
  // 顶部两个同色盒的位置与孔位
  boxPos(i) { return { x: i === 0 ? 75 : 225, y: 78 }; },
  boxHole(bi, i) {
    const p = this.boxPos(bi);
    return { x: p.x + 18 + i * 27, y: p.y + 21 };
  },

  state: 'playing',   // playing | won | lost
  stateTime: 0,
  levelNo: 1,
  plates: [],
  queue: [],          // 所有动态螺丝：dest=box(进盒)|spare(备选格)，state=fly|queued|inbox|popping
  particles: [],
  boxes: [],          // 两个同色盒 {color, filled, pop}
  boxFlies: [],       // 完成后打包飞出的 ghost 盒子
  props: { add: 1, clear: 1 },   // 每关各一次
  showSelect: false,
  bestLevel: 1,
  pendingWin: 0,
  pendingLose: 0,
  removedCount: 0,
  totalCount: 0,

  init() {
    this.bestLevel = Store.get('sp_best', 1);
    this.levelNo = this.bestLevel;
    this.loadLevel(this.levelNo);
  },

  loadLevel(n) {
    this.levelNo = n;
    const lv = Levels.get(n);
    this.capacity = 5;
    this.props = { add: 1, clear: 1 };
    this.boxes = [{ color: -1, filled: 0, pop: 0 }, { color: -1, filled: 0, pop: 0 }];
    this.boxFlies = [];
    this.plates = lv.plates.map(p => ({
      cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot, z: p.z,
      shape: p.shape || 0, pcolor: p.pcolor || 0,
      _cos: Math.cos(p.rot), _sin: Math.sin(p.rot),
      falling: null, fallen: false, shake: 0,
      wobA: 0, wobV: 0,          // 摆动角/角速度（绕剩余螺丝质心的阻尼摆）
      pivot: { x: 0, y: 0 },
      screws: p.holes.map(hl => ({ lx: hl.lx, ly: hl.ly, color: hl.color, removed: false })),
    }));
    this.plates.forEach(p => {
      this.computePivot(p);
      p.wobA = 0; // 开场完全水平（与求解器静态姿态严格一致）；拆动后摆向悬挂平衡角
    });
    this.queue = [];
    this.particles = [];
    this.assignBox(0); // 开局预生成两个指定颜色的盒子（须在板子与队列初始化之后）
    this.assignBox(1);
    this.state = 'playing';
    this.stateTime = 0;
    this.showSelect = false;
    this.pendingWin = 0;
    this.pendingLose = 0;
    this.removedCount = 0;
    this.totalCount = this.plates.reduce((a, p) => a + p.screws.length, 0);
    this.bestLevel = Math.max(this.bestLevel || 1, n);
    Store.set('sp_best', Math.max(Store.get('sp_best', 1), n));
  },

  // 剩余螺丝的质心 = 板当前的悬挂支点
  computePivot(p) {
    const left = p.screws.filter(s => !s.removed);
    if (!left.length) { p.pivot = { x: 0, y: 0 }; return; }
    let x = 0, y = 0;
    for (const s of left) { x += s.lx; y += s.ly; }
    p.pivot = { x: x / left.length, y: y / left.length };
  },

  // 悬挂平衡角：让板质心转到支点正下方。
  // 只剩一颗螺丝时是真正的单摆——板会大幅旋转垂坠到螺丝下方（该板的螺丝就是支点本身，位置不变，
  // 且吊起的板不再遮挡下层，因此大幅摆动不影响求解器的可通关路径）；
  // 多颗时被螺丝钉住，只允许 ±0.08 的小幅倾斜（位移在求解器 COVER_MARGIN=10 的容差内）。
  equilibrium(p) {
    const remaining = p.screws.reduce((a, s) => a + (s.removed ? 0 : 1), 0);
    const dx = -p.pivot.x, dy = -p.pivot.y; // 支点 → 质心
    let eq = Math.PI / 2 - Math.atan2(dy, dx);
    eq = Math.atan2(Math.sin(eq), Math.cos(eq)); // 归一到 [-π, π]
    const cap = remaining === 1 ? Math.PI : 0.08;
    return Math.max(-cap, Math.min(cap, eq));
  },

  screwWorld(p, s) {
    // 板绕剩余螺丝质心（支点）摆动 wobA，再叠加基础朝向
    const dx = s.lx - p.pivot.x, dy = s.ly - p.pivot.y;
    const c = Math.cos(p.wobA), sn = Math.sin(p.wobA);
    const lx = p.pivot.x + dx * c - dy * sn;
    const ly = p.pivot.y + dx * sn + dy * c;
    return {
      x: p.cx + lx * p._cos - ly * p._sin,
      y: p.cy + lx * p._sin + ly * p._cos,
    };
  },

  // 点 (wx,wy) 是否被更高层且未掉落的板压住（按板形状判定，含摆动后的实际位置）。
  // 只剩 ≤1 颗螺丝的板已被"吊起"，是挂不是压——不参与遮挡。
  blockingPlate(wx, wy, z) {
    const M = 10; // 与 levels.js 的 COVER_MARGIN 保持一致
    for (const p of this.plates) {
      if (p.fallen || p.falling || p.z <= z) continue;
      let rem = 0;
      for (const s of p.screws) if (!s.removed) rem++;
      if (rem <= 1) continue;
      const dx = wx - p.cx, dy = wy - p.cy;
      const lx0 = dx * p._cos + dy * p._sin;
      const ly0 = -dx * p._sin + dy * p._cos;
      // 逆摆动：绕支点转回 -wobA
      const rdx = lx0 - p.pivot.x, rdy = ly0 - p.pivot.y;
      const c = Math.cos(p.wobA), sn = Math.sin(p.wobA);
      const lx = p.pivot.x + rdx * c + rdy * sn;
      const ly = p.pivot.y - rdx * sn + rdy * c;
      if (Levels.PlateShapes.inside(p.shape, lx, ly, p.w, p.h, M)) return p;
    }
    return null;
  },

  clickLogical(x, y) {
    if (this.state !== 'playing' || this.pendingWin > 0 || this.pendingLose > 0) return;
    // 顶部关卡胶囊 → 选关面板
    if (x >= 128 && x <= 262 && y >= 14 && y <= 56) { this.showSelect = !this.showSelect; Sound.tap(); return; }
    if (this.showSelect) { this.handleSelectTap(x, y); return; }
    const rb = this.restartBtn;
    if (Math.hypot(x - rb.x, y - rb.y) <= rb.r) { this.loadLevel(this.levelNo); return; }
    for (const b of this.propButtons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) { this.useProp(b.id); return; }
    }
    // 从最上层往下找被点中的螺丝
    const order = this.plates.slice().sort((a, b) => b.z - a.z);
    for (const p of order) {
      if (p.fallen || p.falling) continue;
      for (const s of p.screws) {
        if (s.removed) continue;
        const w = this.screwWorld(p, s);
        if (Math.hypot(x - w.x, y - w.y) <= 24) {
          if (this.blockingPlate(w.x, w.y, p.z)) {
            p.shake = 0.25;
            Sound.blocked();
          } else {
            this.unscrew(p, s);
          }
          return;
        }
      }
    }
    Sound.tap();
  },

  unscrew(p, s) {
    s.removed = true;
    this.removedCount++;
    this.computePivot(p);
    // 拆掉的螺丝偏离新支点越远，力矩越大 → 板甩动越明显
    p.wobV += (s.lx - p.pivot.x) * 0.045 + (Math.random() - 0.5) * 0.5;
    p.wobV = Math.max(-3.5, Math.min(3.5, p.wobV));
    const w = this.screwWorld(p, s);
    // 同色盒优先：颜色由系统预先指定，匹配任一未满的盒即进盒；否则进备选格
    let target = -1;
    for (let bi = 0; bi < this.boxes.length; bi++) {
      const b = this.boxes[bi];
      if (b.color === s.color && b.filled < 3) { target = bi; break; }
    }
    const e = {
      color: s.color, x: w.x, y: w.y, sx: w.x, sy: w.y,
      state: 'fly', t: 0, ang: (p.z % 2 ? 1 : -1) * 0.6,
      dest: target >= 0 ? 'box' : 'spare', box: target, boxIdx: -1, slot: -1,
    };
    if (target >= 0) {
      e.boxIdx = this.boxes[target].filled++;
    } else {
      e.slot = this.queue.filter(q => q.dest === 'spare' && q.state !== 'popping').length;
    }
    this.queue.push(e); // 先入队，再触发完成结算，避免完成清理漏掉刚拆的这颗
    Sound.unscrew();
    if (target >= 0) {
      if (this.boxes[target].filled === 3) this.completeBox(target);
    } else if (e.slot + 1 >= this.capacity) {
      this.pendingLose = 0.5; // 备选格将满 → 失败（备选格只存不消，消除只在盒内）
    }
    this.flowBoxes();      // 同色螺丝自动流转进匹配的盒子
    this.healStuckBoxes(); // 盒色凑不齐时自愈换色

    if (p.screws.every(ss => ss.removed) && !p.falling) {
      p.falling = { t: 0, dir: Math.random() < 0.5 ? -1 : 1 };
      this.spawnBurst(p.cx, p.cy + p.h / 2, '#5a6a7e', 8);
      Sound.thud();
    }
    if (this.removedCount === this.totalCount) this.pendingWin = 0.7;
  },

  // 盒子集满：盒内螺丝立即清空，该盒子"打包"飞出（ghost 动画），即时按规则预生成新盒
  completeBox(bi) {
    const b = this.boxes[bi];
    const pos = this.boxPos(bi);
    this.queue = this.queue.filter(e => !(e.dest === 'box' && e.box === bi));
    this.boxFlies.push({ color: b.color, bi, t: 0 });
    this.spawnBurst(pos.x + 45, pos.y + 21, b.color, 14);
    Sound.boxPop();
    this.assignBox(bi);
    this.boxes[bi].pop = 0.45; // 新盒入场动画
    this.absorbInto(bi); // 自动流转：备选格里同色螺丝吸入新盒（可连锁）
  },

  // 吸入备选格里与该盒同色的螺丝（自动流转），可能连锁完成
  absorbInto(bi) {
    const b = this.boxes[bi];
    for (const e of this.queue) {
      if (b.filled >= 3) break;
      if (e.dest === 'spare' && e.state !== 'popping' && e.color === b.color) {
        e.dest = 'box';
        e.box = bi;
        e.boxIdx = b.filled++;
        if (e.state === 'queued') { e.state = 'fly'; e.t = 0; e.sx = e.x; e.sy = e.y; }
      }
    }
    if (b.filled === 3) this.completeBox(bi); // 连锁
  },

  // 每次拆螺丝后：备选格里与任一盒子同色的螺丝自动流入对应盒子
  flowBoxes() {
    for (let bi = 0; bi < this.boxes.length; bi++) {
      if (this.boxes[bi].color >= 0 && this.boxes[bi].filled < 3) this.absorbInto(bi);
    }
  },

  // 预生成指定颜色的盒子（两个盒子同一规则，互相避开对方的颜色）：
  // 1) 只选"剩余数量 ≥ 3"的颜色——每色总数是 3 的倍数，所以末局一定刚好契合，不会出现凑不齐的半盒；
  // 2) 评分 = 备选格存量（自动流转）优先，并列比可点数量，再并列取最小色号；
  // 3) 没有剩余 ≥3 的颜色时（残局/用了清空孔位），选剩余最多的兜底。
  assignBox(bi) {
    const other = this.boxes[1 - bi];
    const remaining = {}, spareCount = {};
    this.queue.forEach(e => {
      if (e.dest === 'spare' && e.state !== 'popping' && !(e.box === 1 - bi)) {
        remaining[e.color] = (remaining[e.color] || 0) + 1;
        spareCount[e.color] = (spareCount[e.color] || 0) + 1;
      }
    });
    for (const p of this.plates) {
      if (p.fallen) continue;
      for (const s of p.screws) {
        if (!s.removed) remaining[s.color] = (remaining[s.color] || 0) + 1;
      }
    }
    let candidates = Object.keys(remaining).map(Number).sort((a, b) => a - b);
    if (other && other.color >= 0) {
      const filtered = candidates.filter(c => c !== other.color);
      if (filtered.length) candidates = filtered;
    }
    if (!candidates.length) { this.boxes[bi] = { color: -1, filled: 0, pop: 0 }; return; }
    // 剩余 ≥3 的颜色才能凑满一盒
    const full = candidates.filter(c => remaining[c] >= 3);
    const pool = full.length ? full : candidates;
    let best = pool[0], bestN = -1;
    for (const c of pool) {
      const score = (spareCount[c] || 0) * 10 + this.clickableCount(c);
      if (score > bestN) { best = c; bestN = score; }
    }
    this.boxes[bi] = { color: best, filled: 0, pop: 0 };
  },

  // 自愈：某盒子颜色剩余不足以凑满一盒时（一般是用清空孔位打破守恒后），把盒内螺丝退回备选格并换色
  healStuckBoxes() {
    for (let bi = 0; bi < this.boxes.length; bi++) {
      const b = this.boxes[bi];
      if (b.color < 0 || b.filled >= 3 || b.filled === 0) continue;
      const remaining = {};
      this.queue.forEach(e => {
        if (e.dest === 'spare' && e.state !== 'popping') remaining[e.color] = (remaining[e.color] || 0) + 1;
      });
      for (const p of this.plates) {
        if (p.fallen) continue;
        for (const s of p.screws) {
          if (!s.removed) remaining[s.color] = (remaining[s.color] || 0) + 1;
        }
      }
      if ((remaining[b.color] || 0) > 0) continue; // 还有剩余，等得起
      // 凑不齐了：盒内螺丝退回备选格，换一个有剩余的颜色
      let hole = 0;
      for (const e of this.queue) {
        if (e.dest === 'box' && e.box === bi && e.state !== 'popping') {
          e.dest = 'spare';
          e.box = -1;
          e.boxIdx = -1;
          e.slot = hole++;
          if (e.state === 'inbox') { e.state = 'queued'; e.x = this.slotX(e.slot); e.y = this.SLOT_Y; }
        }
      }
      this.assignBox(bi);
      this.absorbInto(bi);
    }
  },

  // 某颜色当前"拿得到"（未被压住）的板载螺丝数
  clickableCount(color) {
    let n = 0;
    for (const p of this.plates) {
      if (p.fallen || p.falling) continue;
      for (const s of p.screws) {
        if (s.removed || s.color !== color) continue;
        const w = this.screwWorld(p, s);
        if (!this.blockingPlate(w.x, w.y, p.z)) n++;
      }
    }
    return n;
  },

  // 选关面板
  handleSelectTap(x, y) {
    if (x < 40 || x > 350 || y < 130 || y > 600) { this.showSelect = false; Sound.tap(); return; }
    const total = Math.min(50, Math.max(20, this.bestLevel));
    for (let n = 1; n <= total; n++) {
      const col = (n - 1) % 5, row = Math.floor((n - 1) / 5);
      const cx = 48 + col * 60, cy = 200 + row * 38;
      if (x >= cx && x <= cx + 54 && y >= cy && y <= cy + 32) {
        if (n <= this.bestLevel) {
          this.showSelect = false;
          this.loadLevel(n);
          Sound.tap();
        } else {
          Sound.blocked();
        }
        return;
      }
    }
  },

  // 道具
  useProp(id) {
    if (id === 'add') {
      if (this.props.add <= 0 || this.capacity >= this.MAX_CAPACITY) { Sound.blocked(); return; }
      this.props.add--;
      this.capacity++;
      Sound.pop();
    } else if (id === 'clear') {
      const live = this.queue.filter(e => e.dest === 'spare' && e.state !== 'popping');
      if (this.props.clear <= 0 || !live.length) { Sound.blocked(); return; }
      this.props.clear--;
      this.pendingLose = 0; // 清空救场：撤销即将到来的失败
      live.forEach(e => { e.state = 'popping'; e.t = 0; this.spawnBurst(e.x, e.y, e.color, 8); });
      Sound.pop();
    }
  },

  spawnBurst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        life: 0.45 + Math.random() * 0.3, max: 0.75,
        r: 2 + Math.random() * 2.5, color,
      });
    }
  },

  update(dt) {
    dt = Math.min(dt, 0.05);
    this.stateTime += dt;

    for (const e of this.queue) {
      if (e.state === 'fly') {
        e.t += dt / 0.34;
        const toBox = e.dest === 'box';
        const target = toBox ? this.boxHole(e.box, e.boxIdx) : { x: this.slotX(e.slot), y: this.SLOT_Y };
        if (e.t >= 1) {
          e.t = 1; e.x = target.x; e.y = target.y;
          if (toBox) e.state = 'inbox';
          else e.state = 'queued';
        } else {
          const ease = 1 - Math.pow(1 - e.t, 3);
          e.x = e.sx + (target.x - e.sx) * ease;
          e.y = e.sy + (target.y - e.sy) * ease - Math.sin(e.t * Math.PI) * 46;
        }
        e.ang += dt * 14;
      } else if (e.state === 'queued') {
        e.x += (this.slotX(e.slot) - e.x) * Math.min(1, dt * 14);
        e.y += (this.SLOT_Y - e.y) * Math.min(1, dt * 14);
      } else if (e.state === 'popping') {
        e.t += dt / 0.24;
      }
    }
    this.queue = this.queue.filter(e => e.state !== 'popping' || e.t < 1);
    // 备选格重排（盒内螺丝不占备选格）
    let si = 0;
    this.queue.forEach(e => { if (e.dest === 'spare' && e.state !== 'popping') e.slot = si++; });

    // 盒子弹入动画计时（纯视觉，逻辑已即时结算）
    for (const b of this.boxes) {
      if (b.pop > 0) b.pop = Math.max(0, b.pop - dt);
    }
    // 打包飞出的 ghost 盒子
    for (const f of this.boxFlies) f.t += dt / 0.6;
    this.boxFlies = this.boxFlies.filter(f => f.t < 1);

    for (const p of this.plates) {
      if (p.falling) {
        p.falling.t += dt / 0.6;
        if (p.falling.t >= 1) { p.fallen = true; p.falling = null; }
      } else if (!p.fallen) {
        // 悬挂摆：绕支点的重力单摆
        const remaining = p.screws.reduce((a, s) => a + (s.removed ? 0 : 1), 0);
        if (remaining > 0) {
          const eq = this.equilibrium(p);
          if (remaining === 1) {
            // 被最后一颗螺丝吊着：大幅旋转垂坠到质心正下方，来回摆动衰减
            p.wobV += (-Math.sin(p.wobA - eq) * 8 - p.wobV * 1.4) * dt;
            p.wobA = Math.max(-2.6, Math.min(2.6, p.wobA + p.wobV * dt));
          } else {
            // 被多颗螺丝钉住：小幅倾斜弹簧
            p.wobV += (-(p.wobA - eq) * 26 - p.wobV * 2.8) * dt;
            p.wobA = Math.max(-0.12, Math.min(0.12, p.wobA + p.wobV * dt));
          }
        }
      }
      if (p.shake > 0) p.shake = Math.max(0, p.shake - dt);
    }

    for (const pt of this.particles) {
      pt.x += pt.vx * dt; pt.y += pt.vy * dt;
      pt.vy += 500 * dt; pt.life -= dt;
    }
    this.particles = this.particles.filter(pt => pt.life > 0);

    if (this.pendingLose > 0) {
      this.pendingLose -= dt;
      if (this.pendingLose <= 0) { this.state = 'lost'; this.stateTime = 0; Sound.fail(); }
    } else if (this.pendingWin > 0) {
      this.pendingWin -= dt;
      if (this.pendingWin <= 0) { this.state = 'won'; this.stateTime = 0; Sound.win(); }
    }
  },
};
