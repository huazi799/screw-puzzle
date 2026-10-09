// 全部绘制：背景、板、螺丝、槽位、HUD、结算浮层（逻辑坐标 390×740）
const Render = (() => {
  const PALETTE = ['#ff5d5d', '#4da3ff', '#5ecf7a', '#ffb545', '#c06cff'];
  const PLATE_COLORS = [ // 粉彩玻璃板（与浅蓝背景协调，与螺丝色错开明度）
    ['#fccb96', '#f5a75f'], // 蜜桃
    ['#a9def8', '#6fc2ea'], // 天蓝
    ['#b5e6bf', '#83cb97'], // 薄荷
    ['#f9b9cd', '#f292ad'], // 粉
    ['#cec0f9', '#ac93ef'], // 淡紫
    ['#f9e5a8', '#f1cd6c'], // 奶黄
  ];
  const FONT = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function pathRoundRect(path, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    path.moveTo(x + r, y);
    path.arcTo(x + w, y, x + w, y + h, r);
    path.arcTo(x + w, y + h, x, y + h, r);
    path.arcTo(x, y + h, x, y, r);
    path.arcTo(x, y, x + w, y, r);
    path.closePath();
  }

  // 板形状 → Path2D（缓存在板上）
  function platePath(p) {
    if (p._path) return p._path;
    const path = new Path2D();
    if (!p.shape || p.shape === 0) {
      pathRoundRect(path, -p.w / 2, -p.h / 2, p.w, p.h, 22);
    } else {
      const pts = Levels.PlateShapes.outline(p.shape, p.w, p.h, 88);
      path.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
      path.closePath();
    }
    p._path = path;
    return path;
  }

  function drawHole(ctx, x, y, r) {
    // 凹陷内壁：半透明深色，透出板色，不再是死黑
    const g = ctx.createRadialGradient(x, y - r * 0.25, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(38, 52, 72, 0.42)');
    g.addColorStop(1, 'rgba(38, 52, 72, 0.66)');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // 内壁下缘受光（光从上来，凹坑底边亮）
    ctx.beginPath();
    ctx.arc(x, y, r - 1.2, Math.PI * 0.12, Math.PI * 0.88);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 内壁上缘阴影
    ctx.beginPath();
    ctx.arc(x, y, r - 1.2, Math.PI * 1.1, Math.PI * 1.9);
    ctx.strokeStyle = 'rgba(30, 42, 60, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 孔口细描边
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(56, 72, 94, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawScrew(ctx, x, y, colorIdx, r, ang) {
    drawHole(ctx, x, y, r + 3);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = PALETTE[colorIdx % PALETTE.length];
    ctx.fill();
    // 金属内盘
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.12, x, y, r * 0.75);
    g.addColorStop(0, '#fbfdff');
    g.addColorStop(0.55, '#c3cedb');
    g.addColorStop(1, '#8b98a8');
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    // 一字槽
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(40,50,64,0.85)';
    roundRect(ctx, -r * 0.52, -r * 0.09, r * 1.04, r * 0.18, r * 0.09);
    ctx.fill();
    ctx.restore();
    // 高光弧
    ctx.beginPath();
    ctx.arc(x, y, r - 2.5, -2.4, -1.2);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawPlate(ctx, p) {
    let dy = 0, extraRot = 0, alpha = 1;
    if (p.falling) {
      const t = p.falling.t, e = t * t;
      dy = e * 340;
      extraRot = e * 0.55 * p.falling.dir;
      alpha = Math.max(0, 1 - t * 1.05);
    }
    const shake = p.shake > 0 ? Math.sin(p.shake * 70) * 3 * (p.shake / 0.25) : 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.cx + shake, p.cy + dy);
    ctx.rotate(p.rot);
    if (p.falling) {
      ctx.rotate((p.wobA || 0) + extraRot); // 掉落：从当前摆角开始翻滚
    } else {
      // 悬挂摆：绕剩余螺丝质心（支点）转动，板被螺丝"吊"着
      ctx.translate(p.pivot.x, p.pivot.y);
      ctx.rotate(p.wobA || 0);
      ctx.translate(-p.pivot.x, -p.pivot.y);
    }
    const path = platePath(p);
    const cols = PLATE_COLORS[(p.pcolor || 0) % PLATE_COLORS.length] || PLATE_COLORS[0];
    // 彩色玻璃板体：半透明，能透出下层的螺丝
    ctx.shadowColor = 'rgba(60, 80, 110, 0.30)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    const grad = ctx.createLinearGradient(0, -p.h / 2, 0, p.h / 2);
    grad.addColorStop(0, cols[0]);
    grad.addColorStop(1, cols[1]);
    ctx.globalAlpha = alpha * 0.78;
    ctx.fillStyle = grad;
    ctx.fill(path);
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = alpha;
    // 白描边 + 细外框（参考风格）
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(path);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(92, 114, 140, 0.5)';
    ctx.stroke(path);
    // 孔与螺丝（保持不透明，保证可读性）
    for (const s of p.screws) {
      if (s.removed) { drawHole(ctx, s.lx, s.ly, 15); continue; }
      drawScrew(ctx, s.lx, s.ly, s.color, 17, s.lx * 0.07 + s.ly * 0.05 + p.z);
    }
    ctx.restore();
  }

  function drawBackground(ctx) {
    const bg = ctx.createLinearGradient(0, 0, 0, 740);
    bg.addColorStop(0, '#e9f4fb');
    bg.addColorStop(0.55, '#d9eaf6');
    bg.addColorStop(1, '#c9e0f0');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 390, 740);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    for (const [x, y, r] of [[60, 130, 120], [330, 420, 160], [80, 600, 90]]) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 顶部两个同色盒 + 打包飞出的 ghost + 盒内/飞行中的螺丝
  function drawBoxes(ctx, g) {
    // ghost：完成时整个盒子从原位向上飞走
    for (const f of g.boxFlies) {
      const pos = g.boxPos(f.bi);
      const gy = pos.y - f.t * 130;
      const tone = PALETTE[f.color] || '#c9d2dd';
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - f.t);
      ctx.beginPath();
      ctx.arc(pos.x + 45, gy + 2, 10, Math.PI, 0);
      ctx.strokeStyle = tone;
      ctx.lineWidth = 5;
      ctx.stroke();
      roundRect(ctx, pos.x, gy, 90, 42, 12);
      ctx.fillStyle = '#fff8e6';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = tone;
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(pos.x + 18 + i * 27, gy + 21, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = tone;
        ctx.fill();
      }
      ctx.restore();
    }
    // 两个盒子
    for (let bi = 0; bi < g.boxes.length; bi++) {
      const b = g.boxes[bi];
      const pos = g.boxPos(bi);
      let scale = 1;
      if (b.pop > 0) scale = 0.75 + 0.25 * (1 - b.pop / 0.45); // 新盒弹入
      ctx.save();
      ctx.translate(pos.x + 45, pos.y + 21);
      ctx.scale(scale, scale);
      ctx.translate(-(pos.x + 45), -(pos.y + 21));
      const tone = b.color >= 0 ? PALETTE[b.color] : '#c9d2dd';
      ctx.beginPath();
      ctx.arc(pos.x + 45, pos.y + 2, 10, Math.PI, 0);
      ctx.strokeStyle = tone;
      ctx.lineWidth = 5;
      ctx.stroke();
      roundRect(ctx, pos.x, pos.y, 90, 42, 12);
      ctx.fillStyle = '#fff8e6';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = tone;
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const h = g.boxHole(bi, i);
        drawHole(ctx, h.x, h.y, 9.5);
      }
      ctx.restore();
    }
    // 盒内与飞向盒子的螺丝
    for (const e of g.queue) {
      if (e.dest !== 'box') continue;
      let r = 7.5, alpha = 1;
      if (e.state === 'fly') r = 7.5 + Math.sin(e.t * Math.PI) * 5;
      if (e.state === 'popping') { r = 7.5 * (1 + e.t * 0.6); alpha = 1 - e.t; }
      ctx.globalAlpha = alpha;
      drawScrew(ctx, e.x, e.y, e.color, r, e.ang);
      ctx.globalAlpha = 1;
    }
  }

  function drawQueue(ctx, g) {
    // 底部面板：备选格
    roundRect(ctx, 34, 646, 322, 74, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fill();
    ctx.strokeStyle = '#b9c8d9';
    ctx.lineWidth = 2;
    ctx.stroke();
    const slotR = Math.min(24, Math.min(62, 300 / g.capacity) / 2 - 2);
    for (let i = 0; i < g.capacity; i++) {
      ctx.beginPath();
      ctx.arc(g.slotX(i), g.SLOT_Y, slotR, 0, Math.PI * 2);
      ctx.fillStyle = '#eef3f9';
      ctx.fill();
      ctx.strokeStyle = '#c3d1e0';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (const e of g.queue) {
      if (e.dest !== 'spare') continue;
      const baseR = Math.min(18, slotR - 2.5);
      let r = baseR, alpha = 1;
      if (e.state === 'fly') r = baseR + Math.sin(e.t * Math.PI) * 6;
      if (e.state === 'popping') { r = baseR * (1 + e.t * 0.6); alpha = 1 - e.t; }
      ctx.globalAlpha = alpha;
      drawScrew(ctx, e.x, e.y, e.color, r, e.ang);
      ctx.globalAlpha = 1;
    }
  }

  // 道具栏：加孔位 / 清空孔位（每关各一次）
  function drawPropsBar(ctx, g) {
    const defs = [
      { id: 'add', label: '加孔位', used: g.props.add <= 0 || g.capacity >= g.MAX_CAPACITY, badge: g.props.add },
      { id: 'clear', label: '清空孔位', used: g.props.clear <= 0, badge: g.props.clear },
    ];
    g.propButtons.forEach((b, i) => {
      const d = defs[i];
      roundRect(ctx, b.x, b.y, b.w, b.h, 12);
      ctx.fillStyle = d.used ? '#b9c8d9' : '#4da3ff';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText(d.label, b.x + b.w / 2, b.y + 25);
      if (!d.used) {
        ctx.beginPath();
        ctx.arc(b.x + b.w - 10, b.y + 10, 8.5, 0, Math.PI * 2);
        ctx.fillStyle = '#5ecf7a';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px ' + FONT;
        ctx.fillText(String(d.badge), b.x + b.w - 10, b.y + 14);
      }
    });
  }

  function drawHud(ctx, g) {
    ctx.textBaseline = 'alphabetic';
    // 左上：重开按钮
    const rb = g.restartBtn;
    ctx.beginPath();
    ctx.arc(rb.x, rb.y, rb.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fill();
    ctx.strokeStyle = '#b9c8d9';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rb.x, rb.y, 9, -0.4, Math.PI * 1.45);
    ctx.strokeStyle = '#44586e';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rb.x + 10.5, rb.y - 9);
    ctx.lineTo(rb.x + 2.5, rb.y - 9.5);
    ctx.lineTo(rb.x + 9.5, rb.y - 1.5);
    ctx.closePath();
    ctx.fillStyle = '#44586e';
    ctx.fill();
    // 顶部中央：关卡胶囊
    roundRect(ctx, 195 - 62, 18, 124, 34, 17);
    ctx.fillStyle = '#3d4b5e';
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px ' + FONT;
    ctx.fillText('第 ' + g.levelNo + ' 关', 195, 41);
    // 胶囊下：每块板的进度点（左→右对应 z 从低到高，掉落的板变浅）
    const dotR = 4.5, gap = 15;
    const x0 = 195 - (g.plates.length - 1) * gap / 2;
    g.plates.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(x0 + i * gap, 68, dotR, 0, Math.PI * 2);
      ctx.fillStyle = p.fallen ? 'rgba(61, 75, 94, 0.22)' : '#3d4b5e';
      ctx.fill();
    });
    // 右上：整体进度百分比
    const pct = g.totalCount ? Math.round(g.removedCount / g.totalCount * 100) : 0;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#3d4b5e';
    ctx.font = 'bold 16px ' + FONT;
    ctx.fillText('进度 ' + pct + '%', 372, 41);
  }

  // 选关面板：点顶部关卡胶囊打开
  function drawSelectOverlay(ctx, g) {
    ctx.fillStyle = 'rgba(228, 236, 244, 0.88)';
    ctx.fillRect(0, 0, 390, 740);
    roundRect(ctx, 40, 130, 310, 470, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#c3d1e0';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#2c3e52';
    ctx.font = 'bold 20px ' + FONT;
    ctx.fillText('选择关卡', 195, 164);
    ctx.fillStyle = '#8fa1b5';
    ctx.font = '12px ' + FONT;
    ctx.fillText('点空白处关闭', 195, 187);
    const total = Math.min(50, Math.max(20, g.bestLevel));
    for (let n = 1; n <= total; n++) {
      const col = (n - 1) % 5, row = Math.floor((n - 1) / 5);
      const x = 48 + col * 60, y = 200 + row * 38;
      const unlocked = n <= g.bestLevel;
      roundRect(ctx, x, y, 54, 32, 8);
      if (unlocked) {
        ctx.fillStyle = n === g.levelNo ? '#4da3ff' : '#eef3f9';
        ctx.fill();
        ctx.strokeStyle = '#c3d1e0';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = n === g.levelNo ? '#ffffff' : '#2c3e52';
      } else {
        ctx.fillStyle = 'rgba(238, 243, 249, 0.6)';
        ctx.fill();
        ctx.fillStyle = '#b9c8d9';
      }
      ctx.font = 'bold 14px ' + FONT;
      ctx.fillText(String(n), x + 27, y + 21);
    }
  }

  function drawOverlay(ctx, g) {
    if (g.state !== 'won' && g.state !== 'lost') return;
    ctx.fillStyle = 'rgba(228, 236, 244, 0.72)';
    ctx.fillRect(0, 0, 390, 740);
    roundRect(ctx, 45, 268, 300, 190, 20);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#c3d1e0';
    ctx.lineWidth = 2;
    ctx.stroke();
    const won = g.state === 'won';
    ctx.textAlign = 'center';
    ctx.fillStyle = won ? '#2f9e4f' : '#d64545';
    ctx.font = 'bold 30px ' + FONT;
    ctx.fillText(won ? '过关！' : '槽位满了', 195, 336);
    ctx.fillStyle = '#5d7186';
    ctx.font = '16px ' + FONT;
    ctx.fillText(won ? '第 ' + (g.levelNo + 1) + ' 关等你来拆' : '就差一点点，再试一次', 195, 372);
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(g.stateTime * 5);
    ctx.fillStyle = '#2c3e52';
    ctx.font = 'bold 17px ' + FONT;
    ctx.fillText(won ? '点击屏幕 → 下一关' : '点击屏幕 → 重试', 195, 420);
    ctx.globalAlpha = 1;
  }

  function draw(ctx, g) {
    drawBackground(ctx);
    // 板按 z 从低到高绘制，上层板自然盖住下层螺丝
    for (const p of g.plates.slice().sort((a, b) => a.z - b.z)) {
      if (p.fallen) continue;
      drawPlate(ctx, p);
    }
    if (g.levelNo <= 2 && g.state === 'playing') {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#5d7d95';
      ctx.font = '12px ' + FONT;
      ctx.fillText('螺丝优先进同色盒 · 备选格满则败', 195, 100);
    }
    drawQueue(ctx, g);
    drawPropsBar(ctx, g);
    drawHud(ctx, g);
    drawBoxes(ctx, g);
    // 粒子最上层
    for (const pt of g.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.max);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fillStyle = pt.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawOverlay(ctx, g);
    if (g.showSelect) drawSelectOverlay(ctx, g);
  }

  return { draw, PALETTE };
})();
