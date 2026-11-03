(() => {
  'use strict';
  // ---------- shared helpers, calendar and storage
  const G = window.AfterimageDoodles, DG = window.AfterimageGrader, N = G.BOARD, R = DG.RULES;
  const $ = id => document.getElementById(id);
  const LOOK_MS = 10000, DRAW_MS = { 1: 45000, 2: 60000, 3: 75000 };
  const LEVELS = { 1: 'Easy', 2: 'Normal', 3: 'Hard' };
  const tok = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  const pct = v => `${Math.round(v * 100)}%`;
  const pct1 = v => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const r2 = v => Math.round(v * 100) / 100;
  const units = v => String(Math.round(v * 10) / 10);
  const one = v => (Math.round(v * 10) / 10).toFixed(1);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const rad = d => (d * Math.PI) / 180;
  const letter = k => (k < 26 ? String.fromCharCode(65 + k) : String(k + 1));
  const ERASE_R = 0.4;   // the eraser removes ink within 0.4 grid units of the pointer
  const MOVE_MIN = 0.04; // pencil points closer than this to the last one are skipped
  // ---------- calendar: scene No. 1 is Nov 1, 2026, in the player's own time zone
  const EPOCH = Date.UTC(2026, 10, 1);
  const dayOf = (d = new Date()) => Math.max(0, Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 864e5));
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateLabel = d => `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  const dailySeed = day => 5000 + day;
  // ---------- this viewer's own history (browser storage, optional). Doodle rounds use their own key.
  const KEY = 'glance:v5';
  let store = {};
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); if (v && typeof v === 'object') store = v; } catch (e) { store = {}; }
  if (!store.days || typeof store.days !== 'object') store.days = {};
  const writeStore = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* storage unavailable: play continues */ } };
  // strokes are stored and graded in one rounded form (hundredths of a grid unit) so a saved round regrades the same
  const tidy = strokes => strokes.filter(st => Array.isArray(st) && st.length).map(st => st.map(([x, y]) => [r2(x), r2(y)]));

  // ---------- drawing
  const lineW = size => Math.max(2.5, size / 130);
  function drawGrid(c, size) {
    const k = size / N;
    c.save(); c.lineWidth = 1;
    for (const major of [false, true]) {
      c.strokeStyle = tok(major ? '--grid-major' : '--grid'); c.beginPath();
      for (let i = 1; i < N; i++) {
        if ((i % 5 === 0) !== major) continue;
        const p = i * k; c.moveTo(p, 0); c.lineTo(p, size); c.moveTo(0, p); c.lineTo(size, p);
      }
      c.stroke();
    }
    c.restore();
  }
  // a part of the picture as a canvas path, from its outline in grid units (open for lines and arcs)
  const isOpen = p => p.kind === 'line' || p.kind === 'arc';
  function partPath(c, p, k) {
    const pts = G.outline(p, 72); c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x * k, y * k) : c.moveTo(x * k, y * k)));
    if (!isOpen(p)) c.closePath();
  }
  function paint(c, p, k, stroke, fill, width, dash) {
    partPath(c, p, k);
    if (fill && !isOpen(p)) { c.fillStyle = fill; c.fill(); }
    c.save(); c.strokeStyle = stroke; c.lineWidth = width; c.lineJoin = 'round'; c.lineCap = 'round'; if (dash) c.setLineDash(dash); c.stroke(); c.restore();
  }
  // the picture as players see it: the doodle's colours with dark outlines; dots are filled
  function paintPicture(c, scene, k, lw) {
    for (const p of scene.parts) {
      if (p.kind === 'dot') { partPath(c, p, k); c.fillStyle = tok('--d-' + (p.fill || 'ink')); c.fill(); continue; }
      paint(c, p, k, tok('--d-line'), p.fill ? tok('--d-' + p.fill) : null, isOpen(p) || !p.fill ? lw * 1.3 : lw);
    }
  }
  // a fitted line from the grader carries its centre, length and direction; drawing needs its two ends
  const poseToPart = q => (q.kind === 'line' ? Object.assign({}, q, { x1: q.x - (q.w / 2) * Math.cos(rad(q.r)), y1: q.y - (q.w / 2) * Math.sin(rad(q.r)), x2: q.x + (q.w / 2) * Math.cos(rad(q.r)), y2: q.y + (q.w / 2) * Math.sin(rad(q.r)) }) : q);
  const labelAt = p => { if (p.kind === 'line') return [(p.x1 + p.x2) / 2, (p.y1 + p.y2) / 2]; if (p.kind === 'arc') { const o = G.outline(p, 32); return o[o.length >> 1]; } return [p.x, p.y]; };
  // a freehand stroke, smoothed only for display (curves through the midpoints of the points you drew)
  function inkPath(c, st, k) {
    c.beginPath(); c.moveTo(st[0][0] * k, st[0][1] * k);
    if (st.length === 1) { c.lineTo(st[0][0] * k + 0.01, st[0][1] * k); return; }
    for (let i = 1; i < st.length - 1; i++) { const a = st[i], b = st[i + 1]; c.quadraticCurveTo(a[0] * k, a[1] * k, ((a[0] + b[0]) / 2) * k, ((a[1] + b[1]) / 2) * k); }
    const L = st[st.length - 1]; c.lineTo(L[0] * k, L[1] * k);
  }
  function drawInk(c, strokes, k, color, width, dash, alpha) {
    c.save(); c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
    if (dash) c.setLineDash(dash);
    if (alpha !== undefined) c.globalAlpha = alpha;
    for (const st of strokes) { if (!st.length) continue; inkPath(c, st, k); c.stroke(); }
    c.restore();
  }
  function badge(c, x, y, text, bg, fg, square) {
    c.save(); c.font = `600 10px ${tok('--font-mono') || 'monospace'}`;
    const w = Math.max(18, c.measureText(text).width + 9);
    c.fillStyle = bg; c.beginPath();
    if (c.roundRect) c.roundRect(x - w / 2, y - 9, w, 18, square ? 4 : 9); else c.rect(x - w / 2, y - 9, w, 18);
    c.fill(); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y + 0.5); c.restore();
  }
  // The graded board. p runs 0 -> 1 to reveal the original part by part. layers: { orig, ink, fit, labels }.
  function drawResult(c, size, scene, g, p, L) {
    const k = size / N, P = scene.parts, lw = lineW(size), late = clamp01((p - 0.6) / 0.3);
    if (late > 0 && L.orig) {
      c.save(); c.globalAlpha = late * 0.75; c.fillStyle = tok('--hl'); c.strokeStyle = tok('--hl'); c.lineWidth = lw * 4; c.lineCap = 'round';
      g.rows.forEach((r, i) => { if (!r.graded || r.found) return; partPath(c, P[i], k); if (isOpen(P[i])) c.stroke(); else c.fill(); });
      c.restore();
    }
    if (L.ink) {
      drawInk(c, g.ink, k, tok('--pencil'), lw, null, 0.9);
      if (late > 0) drawInk(c, g.extraRuns, k, tok('--critical'), lw * 1.3, [lw * 2.5, lw * 2], late);
    }
    if (L.fit) g.rows.forEach(r => {
      if (!r.found) return;
      if (r.kind === 'dot') { c.save(); c.strokeStyle = tok('--fit'); c.lineWidth = lw; c.setLineDash([lw * 2, lw * 1.5]); c.beginPath(); c.arc(r.at[0] * k, r.at[1] * k, Math.max(0.3, (r.diam || 0.4) / 2) * k + 2, 0, Math.PI * 2); c.stroke(); c.restore(); return; }
      paint(c, poseToPart(r.fit), k, tok('--fit'), null, lw, [lw * 3, lw * 2]);
    });
    if (L.orig) P.forEach((s, i) => {
      const a = clamp01((p - (0.55 * i) / P.length) / 0.12);
      if (a <= 0) return;
      c.save(); c.globalAlpha = a;
      if (s.kind === 'dot') { partPath(c, s, k); c.fillStyle = tok('--blue'); c.fill(); } else paint(c, s, k, tok('--blue'), null, lw * 1.1);
      c.restore();
    });
    if (L.labels && L.orig) g.rows.forEach((r, i) => { if (!r.graded) return; const at = labelAt(P[i]); badge(c, at[0] * k, at[1] * k, String(i + 1), r.found ? tok('--blue') : tok('--hl'), r.found ? tok('--card') : tok('--hl-ink')); });
  }

  // remove the ink within ERASE_R of the eraser's path from a to b, splitting strokes where the eraser crosses them
  function eraseAlong(a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
    const near = q => { const t = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * vx + (q[1] - a[1]) * vy) / L2)) : 0; return Math.hypot(q[0] - a[0] - t * vx, q[1] - a[1] - t * vy) <= ERASE_R; };
    let changed = false;
    const out = [];
    for (const st of state.strokes) {
      if (!st.some(near)) { out.push(st); continue; }
      changed = true;
      let run = [];
      for (const q of st) { if (near(q)) { if (run.length) out.push(run); run = []; } else run.push(q); }
      if (run.length) out.push(run);
    }
    if (changed) state.strokes = out;
    return changed;
  }

  // the grader's result plus the totals the score bar needs: category points that add up exactly to the score
  function apportion(exact, total) { const fl = exact.map(v => Math.floor(Math.max(0, v))); let rest = total - fl.reduce((a, b) => a + b, 0); const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]); for (let j = 0; j < order.length && rest > 0; j++, rest--) fl[order[j][1]]++; return fl; }
  function gradeOf(scene, strokes) {
    const g = DG.grade(scene, strokes), earned = Math.round(g.gross);
    g.strokeParts = g.strokes; g.ink = strokes;
    g.earned = earned; g.lost = Math.max(0, earned - g.score); g.notEarned = 100 - earned;
    const kept = apportion(g.categories.map(c => (g.gross > 0 ? (c.earned * g.score) / g.gross : 0)), g.score), before = apportion(g.categories.map(c => c.earned), earned);
    g.categories.forEach((c, i) => { c.points = kept[i]; c.earnedPoints = before[i]; });
    const W = g.rows.reduce((a, r) => a + r.weight, 0) || 1;
    g.rows.forEach((r, i) => { r.i = i; r.share = (100 * r.weight) / W; r.points = r.share * (r.credit || 0); });
    g.weightSum = W;
    return g;
  }

  // ---------- the score scale: one 100-point bar, split into category points, points lost, and points not earned
  const CAT_CLASS = ['c1', 'c2', 'c3', 'c4'];
  const lossText = g => (g.penalty > 0 ? `${one(g.unexplained)} units of ink that draw no part of the picture (−${one(g.penalty)})` : '');
  function scaleParts(g) {
    const parts = g.categories.map((c, i) => ({ cls: CAT_CLASS[i], name: c.name, value: c.points,
      tip: `${c.name}: ${c.points} of ${c.weight} points, ${pct(c.accuracy)} accuracy${g.lost && c.earnedPoints !== c.points ? ` (${c.earnedPoints} before deductions)` : ''}` }));
    parts.push({ cls: 'lost', name: 'Lost to extra ink', value: g.lost, tip: `Lost: ${g.lost} points for ${lossText(g) || 'nothing'}.` });
    parts.push({ cls: 'none', name: 'Not earned', value: g.notEarned, tip: `Not earned: ${g.notEarned} points missed across the categories.` });
    return parts;
  }
  const rubricParts = () => DG.RUBRIC.map((r, i) => ({ cls: CAT_CLASS[i], name: r.name, value: r.weight, label: `${r.weight}`, tip: `${r.name}: worth up to ${r.weight} points` }));
  function renderScale(host, parts, caption, aria) {
    host.textContent = '';
    if (caption) host.appendChild(mk('p', 'scale-cap', caption));
    const bar = mk('div', 'scale'); bar.setAttribute('role', 'img'); bar.setAttribute('aria-label', aria);
    const tip = mk('div', 'tip'); tip.hidden = true;
    for (const p of parts) {
      if (!(p.value > 0)) continue;
      const seg = mk('div', 'seg ' + p.cls); seg.style.flex = `${p.value} 1 0`; seg.tabIndex = 0; seg.setAttribute('aria-label', p.tip);
      seg.appendChild(mk('span', '', p.label || String(p.value)));
      const show = () => { tip.textContent = p.tip; tip.hidden = false; const hb = host.getBoundingClientRect(), sb = seg.getBoundingClientRect(); tip.style.left = '0px'; const tw = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(hb.width - tw, sb.left - hb.left + sb.width / 2 - tw / 2)) + 'px'; };
      const hide = () => { tip.hidden = true; };
      seg.addEventListener('pointerenter', show); seg.addEventListener('pointerleave', hide);
      seg.addEventListener('focus', show); seg.addEventListener('blur', hide);
      bar.appendChild(seg);
    }
    host.appendChild(bar);
    const ends = mk('div', 'scale-ends'); ends.append(mk('span', '', '0'), mk('span', '', '100')); host.appendChild(ends);
    const legend = mk('ul', 'legend');
    for (const p of parts) { if (!(p.value > 0)) continue; const li = mk('li'); li.append(mk('i', p.cls), document.createTextNode(p.name)); legend.appendChild(li); }
    host.appendChild(legend);
    host.appendChild(tip);
    requestAnimationFrame(() => fitLabels(bar));
  }
  // a label prints inside its block only when it fits with room to spare; otherwise the legend, tooltip and tables carry it
  function fitLabels(bar) { for (const seg of bar.children) { const lab = seg.firstChild; lab.hidden = false; lab.hidden = lab.scrollWidth + 12 > seg.clientWidth; } }
  const scaleAria = g => `Score ${g.score} out of 100. ` + g.categories.map(c => `${c.name} ${c.points} of ${c.weight}`).join(', ') + `. Lost ${g.lost}. Not earned ${g.notEarned}.`;
  const EMOJI = { pig: '🐷', penguin: '🐧', cat: '🐱', frog: '🐸', dog: '🐶', duck: '🦆', bear: '🐻', bunny: '🐰', owl: '🦉', fish: '🐟', snail: '🐌', snowman: '⛄', robot: '🤖', crown: '👑', tophat: '🎩', partyhat: '🥳', sunglasses: '🕶️', bowtie: '🎀', umbrella: '☂️', balloon: '🎈', bicycle: '🚲', skateboard: '🛹', bench: '🪑', tree: '🌳', house: '🏠', sun: '☀️', cloud: '☁️', rain: '💧', notes: '🎵', jumplines: '💨' };
  const square = r => (!r.found ? '⬜' : r.credit >= 0.85 ? '🟩' : r.credit >= 0.5 ? '🟨' : '⬜');

  // ---------- Scorecard tab
  const ICONS = {
    rect: '<rect class="shape-ico" x="5" y="7.5" width="18" height="13" rx="1"/>',
    ellipse: '<ellipse class="shape-ico" cx="14" cy="14" rx="10" ry="7.5"/>',
    tri: '<path class="shape-ico" d="M14 4.5 L24 23 H4 Z"/>',
    semi: '<path class="shape-ico" d="M3.5 19.5 A10.5 10.5 0 0 1 24.5 19.5 Z"/>',
    line: '<path class="shape-ico" d="M5 22 L23 6"/>',
    arc: '<path class="shape-ico" d="M5 10 Q14 27 23 10" fill="none"/>',
    dot: '<circle class="shape-ico dot" cx="14" cy="14" r="4.5"/>',
  };
  const KIND = { ellipse: 'oval', rect: 'rectangle', tri: 'triangle', semi: 'half-oval', line: 'line', arc: 'arc', dot: 'dot', bar: 'bar' };
  const NEED = { 1: 'silhouette', 2: 'signature feature', 3: 'detail', 4: 'minor detail' };
  function glyph(kind) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 28 28'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'shape-ico');
    s.innerHTML = ICONS[kind] || ICONS.ellipse; return s;
  }
  const dims = d => (!d ? '?' : d.length === 1 ? `${units(d[0])} long` : `${units(d[0])}×${units(d[1])}`);
  function metric(name, cls, value, sub) {
    const d = mk('div', 'metric ' + cls);
    const bar = mk('span', 'minibar'), fill = mk('i'); fill.style.width = pct(value); bar.appendChild(fill);
    d.append(mk('span', 'mk', name), mk('span', 'mv', pct(value)), bar, mk('span', 'ms', sub));
    return d;
  }
  function missText(r) {
    if (r.wrongKind) return `Missed: the ink here reads as a ${KIND[r.wrongKind] || r.wrongKind}, not a ${KIND[r.kind]}, so it earns nothing.`;
    if (r.rejected && r.rejected.length) return `Missed: the nearest ink was rejected (${r.rejected.join('; ')}), so it earns nothing.`;
    if (r.kind === 'dot') return 'Missed: no small mark where this dot belongs, so it earns nothing.';
    return `Missed: not enough of its outline has your strokes running along it (${pct(r.coverage || 0)}; ${pct(R.found)} needed), so it earns nothing.`;
  }
  function partRow(r, p, g) {
    const li = mk('li', 'srow' + (r.found ? '' : ' missed'));
    const head = mk('div', 'srow-head'), name = mk('div', 'sname'), pts = mk('div', 'spts', one(r.points));
    const size = p.kind === 'line' ? `${units(p.w)} long` : p.kind === 'dot' ? `${units(p.w)} across` : `${units(p.w)}×${units(p.h)}`;
    name.append(mk('b', '', cap(p.part)), mk('span', '', `${r.objectName} · ${KIND[p.kind]}, ${size}${p.kind !== 'dot' && Math.round(p.r) ? `, turned ${Math.round(p.r)}°` : ''} · ${NEED[p.need]}, weight ${one(r.weight)}`));
    pts.appendChild(mk('small', '', ` / ${one(r.share)}`));
    head.append(mk('span', 'badge', String(r.i + 1)), glyph(p.kind), name, pts);
    li.appendChild(head);
    if (!r.found) { li.appendChild(mk('p', 'smiss', missText(r))); return li; }
    const m = r.measures || {}, mm = mk('div', 'metrics');
    const posSub = m.relErr === null || m.relErr === undefined ? `object ${one(m.placeErr)} units off` : `object ${one(m.placeErr)} units off · ${pct(m.relErr)} off on its ${r.parentName || 'parent'}`;
    mm.append(
      metric('Shape', 'c1', r.credits.shape, p.kind === 'dot' ? 'any small mark' : `outline ${pct1(m.E)} of its size off${m.kappa < 1 ? ` · looks partly like a ${KIND[m.bestKind] || m.bestKind}` : ''}${r.asLine ? ' · drawn as one line' : ''}`),
      metric('Size', 'c2', r.credits.size, p.kind === 'dot' ? (r.tap ? 'a tap' : `${units(r.diam)} vs ${units(p.w)} across`) : `${dims(m.dims)} vs ${dims(m.refDims)}, as seen`),
      metric('Position', 'c3', r.credits.position, posSub),
      metric('Turn', 'c4', r.credits.orientation, m.turnErr === null || m.turnErr === undefined ? (p.kind === 'dot' ? 'a dot has no turn' : 'round: any turn works') : `${Math.round(m.turnErr)}° off`),
    );
    li.appendChild(mm);
    return li;
  }
  function strokeRow(s, n, g) {
    const names = s.parts.map(id => { const r = g.rows.find(x => x.id === id); return r ? `${r.i + 1} ${r.part}` : id; });
    const li = mk('li', 'rrow' + (names.length ? '' : ' extra')), main = mk('div', 'rmain');
    main.append(mk('b', '', `${units(s.len)} units of ink`), mk('span', '', names.length ? `Draws ${names.join(', ')}` : 'Draws no part of the picture'));
    li.append(mk('span', 'letter', letter(n)), main, mk('span', 'rpair', names.length ? `${names.length} part${names.length === 1 ? '' : 's'}` : 'extra ink'));
    return li;
  }
  function renderScorecard() {
    const has = !!lastCard;
    $('scEmpty').hidden = has; $('scBody').hidden = !has; $('scScoreWrap').hidden = !has;
    if (!has) {
      $('scSub').textContent = 'No round graded yet.';
      renderScale($('rubricScale'), rubricParts(), 'The 100 points', 'Shape 40 points, Size 25, Position 20, Turn 15. Ink that draws no part of the picture is subtracted.');
      renderRules(null, null);
      return;
    }
    const g = lastCard.grade, scene = lastCard.scene, graded = g.rows.filter(r => r.graded);
    $('scSub').textContent = `${lastCard.title} · ${scene.caption} · ${verdictOf(g.score)}`;
    $('scScore').textContent = g.score;
    renderScale($('scScale'), scaleParts(g), '', scaleAria(g));
    const math = $('scMath'); math.textContent = '';
    math.append(document.createTextNode(`Earned: ${g.categories.map(c => c.earnedPoints).join(' + ')} = ${g.earned}`), mk('br'),
      document.createTextNode(`Extra ink: ${one(g.unexplained)} units → ${g.penalty > 0 ? `−${one(g.penalty)}` : '0'}`), mk('br'),
      mk('b', '', `Score: ${g.earned} − ${g.lost} = ${g.score}`));
    if (g.lost) { math.appendChild(mk('br')); math.appendChild(mk('span', 'sub', `Deductions never take the score below 0. They come out of each category in proportion to what it earned, so the colored blocks add up to your score.`)); }
    $('scShapesNote').textContent = `${graded.length} parts. Each counts by importance: silhouette 3, signature feature 2, detail 1, minor detail 0.5, times its size against its object's main part (0.5 to 1), times 1 for the character, 0.7 for what it wears, holds or rides, 0.5 for scenery. Its share of the 100 points is its weight over the total of ${one(g.weightSum)}. Measurements read yours vs the original, in grid units.`;
    const list = $('scShapes'); list.textContent = '';
    graded.forEach(r => list.appendChild(partRow(r, scene.parts[r.i], g)));
    $('scRecNote').textContent = `The grader placed each object first: ${g.objects.map(o => `the ${o.name} ${o.found ? `(${one(Math.hypot(o.transform.tx, o.transform.ty))} units from its spot, ${pct(o.transform.s)} size)` : '(not found)'}`).join('; ')}. Then it fitted each part to the strokes that run along its outline. Your strokes, left to right by where they start, and the parts each one draws:`;
    const rl = $('scRec'); rl.textContent = '';
    g.strokeParts.forEach((s, n) => rl.appendChild(strokeRow(s, n, g)));
    const un = $('scUnrec'); un.textContent = '';
    un.append(mk('span', '', `${one(g.unexplained)} units of ink draw no part of the picture (red dashes on the board below). The first ${R.inkFree} units are free, then ${R.inkRate} points per unit, up to ${R.inkCap}.`), mk('b', '', g.penalty > 0 ? `−${one(g.penalty)}` : '0'));
    renderRules(g, scene);
    renderMap();
  }
  function renderMap() {
    if (!lastCard) return;
    const host = $('mapCard'), c = $('mapCanvas'), r = host.getBoundingClientRect();
    if (!r.width) return;
    const size = r.width, dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.round(size * dpr); c.height = Math.round(size * dpr);
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, size, size);
    drawGrid(x, size);
    drawResult(x, size, lastCard.scene, lastCard.grade, 1, { orig: $('lyOrig').checked, ink: $('lyInk').checked, fit: $('lyFit').checked, labels: true });
  }
  ['lyOrig', 'lyInk', 'lyFit'].forEach(id => $(id).addEventListener('change', renderMap));

  // ---------- the scale: each rule, with a ruler showing how a measurement turns into credit and where your shapes landed
  function ruler(color, ticks, dots) {
    const wrap = mk('div', 'ruler'); wrap.style.setProperty('--c', `var(${color})`);
    // equal values share one pill; pills that would touch stack upward
    const groups = [];
    dots.slice().sort((a, b) => a.at - b.at || a.n - b.n).forEach(d => {
      const gp = groups.find(x => Math.abs(x.at - d.at) < 0.005);
      if (gp) gp.ns.push(d.n); else groups.push({ at: d.at, ns: [d.n] });
    });
    const width = Math.max(240, ($('rules').clientWidth || 300) - 24), rowsEnd = [];
    groups.forEach(gp => {
      const label = gp.ns.join(' '), wPct = ((14 + 7 * label.length) / width) * 100;
      const left = gp.at < 0.08 ? gp.at * 100 - 4 : gp.at > 0.92 ? gp.at * 100 - wPct + 4 : gp.at * 100 - wPct / 2;
      let row = 0; while (rowsEnd[row] !== undefined && rowsEnd[row] > left - 1) row++;
      rowsEnd[row] = left + wPct; gp.row = row; gp.label = label;
    });
    const dotBox = mk('div', 'ruler-dots'); dotBox.style.height = `${rowsEnd.length * 23}px`;
    groups.forEach(gp => {
      const el = mk('span', 'ruler-dot', gp.label);
      el.style.left = `${gp.at * 100}%`; el.style.bottom = `${gp.row * 23}px`;
      el.style.transform = gp.at < 0.08 ? 'translateX(-10px)' : gp.at > 0.92 ? 'translateX(calc(-100% + 10px))' : 'translateX(-50%)';
      el.title = `Shape${gp.ns.length > 1 ? 's' : ''} ${gp.ns.join(', ')}`;
      dotBox.appendChild(el);
    });
    const tickBox = mk('div', 'ruler-ticks');
    ticks.forEach((t, i) => {
      const el = mk('span', 'ruler-tick' + (i === 0 ? ' first' : i === ticks.length - 1 ? ' last' : ''));
      el.style.left = `${t.at * 100}%`; el.append(mk('b', '', t.label));
      if (t.sub) el.appendChild(mk('span', '', t.sub));
      tickBox.appendChild(el);
    });
    wrap.append(dotBox, mk('div', 'ruler-track'), tickBox);
    return wrap;
  }
  function renderRules(g, scene) {
    const host = $('rules'); host.textContent = '';
    const rows = g ? g.rows.filter(r => r.graded) : [], found = rows.filter(r => r.found), n = rows.length;
    const nums = list => list.map(r => r.i + 1).join(', ');
    const cat = key => g && g.categories.find(c => c.key === key);
    const block = (title, right, text, cls) => {
      const d = mk('div', 'rule'), h = mk('div', 'rule-head'), b = mk('b');
      if (cls) b.appendChild(mk('i', cls));
      b.appendChild(document.createTextNode(title));
      h.append(b, mk('span', 'rule-pts', right)); d.append(h, mk('p', '', text)); host.appendChild(d);
      return d;
    };
    const you = (d, text) => { if (g && text) d.appendChild(mk('p', 'you', text)); };
    const catLine = key => { const c = cat(key); return `${pct(c.accuracy)} accuracy over all ${n} parts, weighted = ${one(c.earned)} of ${c.weight} points.`; };
    const credit = (v, z0, z1) => clamp01(1 - (v - z0) / (z1 - z0));

    const find = block('Finding the picture', g ? `${g.objects.filter(o => o.found).length} of ${g.objects.length} objects` : 'step 1',
      `Your strokes are kept exactly as you drew them and read every ${R.inkStep} units, in a fixed order, so the order and direction you drew in change nothing. Each object (the character, what it wears, holds or rides, the scenery) is found first: its visible outline is slid, scaled and turned over your ink until it is best covered, counting only ink that runs the same way as the outline. Then every part is fitted inside its object, its centre, width, height and turn free, to the strokes that run along its outline. A part hidden behind another in the picture is judged only on what shows of it, so drawing only the visible edge is right, and drawing the hidden edge too costs nothing.`);
    you(find, g ? g.objects.map(o => `${cap(o.name)}: ${o.found ? 'found' : 'not found'}.`).join(' ') : '');

    const fit = block('Is the part there?', g ? `${found.length} of ${n} found` : 'step 2',
      `Each bit of ink belongs to the part whose outline it lies along: within ${R.tau[0]} + ${R.tau[1]} × the part's size units, running within ${R.align}° of it. Outlines that run together, like a hat brim on a head, share the ink. A part is found when its own ink, in continuous runs along it, covers at least ${pct(R.found)} of its visible outline; scribbles only cross outlines, so they don't count. It isn't found if that ink sits far from where its object puts it, is the wrong size or proportions by far, or already belongs to another part's outline. A dot is any tap or small mark near where its parent says it belongs. A missing part earns nothing.`);
    you(fit, g && rows.some(r => !r.found) ? `Missed: part${rows.filter(r => !r.found).length > 1 ? 's' : ''} ${nums(rows.filter(r => !r.found))}.` : g ? 'Every part was found.' : '');

    const S = R.shape;
    const s1 = block('Shape', g ? `${cat('shape').points} / 40` : '40 points',
      `How closely your ink follows the part's outline, with size and position taken out: the original outline is moved, turned and scaled evenly onto your ink, then E = (the average distance from your ink to the outline + the average distance from the visible outline to your ink) ÷ 2 ÷ the part's size. E of ${pct(S[0])} or less earns 100%, ${pct(S[1])} or more earns 0, in a straight line between. If another kind of shape (oval, rectangle, triangle, half-oval) fits your ink clearly better, the credit shrinks, and at ${R.kind[1]}× better the part counts as not drawn. A thin bar may be drawn as one line. A dot is any small mark.`, 'c1');
    const eTicks = [0, 0.25, 0.5, 0.75, 1].map(f => { const v = S[0] + f * (S[1] - S[0]); return { at: f, label: pct1(v), sub: pct(credit(v, S[0], S[1])) }; });
    s1.appendChild(ruler('--cat-1', eTicks, found.filter(r => r.measures && r.measures.E !== undefined).map(r => ({ at: clamp01((r.measures.E - S[0]) / (S[1] - S[0])), n: r.i + 1 }))));
    you(s1, g ? catLine('shape') : '');

    const s2 = block('Size', g ? `${cat('size').points} / 25` : '25 points',
      `The width and height of what shows of the part, against your ink's along the same axes, in grid units. Each is compared as (smaller + ${R.slack}) ÷ (larger + ${R.slack}), so a slip of a tenth of a unit on a thin part doesn't count: ${R.size[0]} or more earns full credit, ${R.size[1]} or less earns nothing, in a straight line between. The two are multiplied, so a part squashed or stretched loses points too. A line is measured by its length, a dot by its diameter, which can be anything from ${R.dot[0]}× to ${R.dot[1]}× the original's.`, 'c2');
    s2.appendChild(ruler('--cat-2', [100, 75, 50, 25, 0].map((v, i) => ({ at: i / 4, label: `${v}%` })), found.map(r => ({ at: 1 - r.credits.size, n: r.i + 1 }))));
    you(s2, g ? catLine('size') : '');

    const s3 = block('Position', g ? `${cat('position').points} / 20` : '20 points',
      `Two halves. Half is where its object sits: the object's centre against the original's, full credit within ${R.place[0]} units, nothing at ${R.place[1]}. Half is where the part sits on its parent (an eye on the head, the snout at the front of it), measured as a share of the parent's size at the object's own scale and turn: full credit within ${pct(R.rel[0])}, nothing at ${pct(R.rel[1])}. So a whole pig drawn two units to the left loses position points once, not on every part, and a pig drawn smaller keeps its parts where they belong. An object's main part counts its placement only.`, 'c3');
    s3.appendChild(ruler('--cat-3', [100, 75, 50, 25, 0].map((v, i) => ({ at: i / 4, label: `${v}%` })), found.map(r => ({ at: 1 - r.credits.position, n: r.i + 1 }))));
    you(s3, g ? catLine('position') : '');

    const s4 = block('Turn', g ? `${cat('orientation').points} / 15` : '15 points',
      `How far the part is turned from the original, in degrees, counting its symmetry: an oval, rectangle or line looks the same after half a turn, a square after a quarter, an equilateral triangle after a third, and a round oval or a dot after any turn, so those earn full marks. Full credit within ${R.turn[0]}° (or the turn that moves a short part's end by ${R.endSlip} units, if that is more), then it falls in a straight line to 0 at ${R.turn[1] - R.turn[0]}° beyond that. A beak or a smile drawn upside down earns nothing here.`, 'c4');
    const turned = found.filter(r => r.measures && r.measures.turnErr !== null && r.measures.turnErr !== undefined);
    s4.appendChild(ruler('--cat-4', [0, 10, 20, 30, 40, 50].map(d => ({ at: d / 50, label: `${d}°` })), turned.map(r => ({ at: Math.min(r.measures.turnErr, 50) / 50, n: r.i + 1 }))));
    you(s4, g ? catLine('orientation') : '');

    const s5 = block('Extra ink', g ? (g.lost ? `−${g.lost}` : '0') : `−${R.inkRate} a unit`,
      `Ink that draws no part of the picture (scribbles, stray marks, things that aren't there) costs ${R.inkRate} points per grid unit after the first ${R.inkFree} units, up to ${R.inkCap} points. Drawing the hidden part of an outline costs nothing.`, 'lost');
    you(s5, g ? `${one(g.unexplained)} units of extra ink.` : '');

    block('Your score', g ? `${g.score} / 100` : '0–100', `Each part earns its share of the 100 points × (40% shape + 25% size + 20% position + 15% turn). Add them up, take off extra ink, and round to a whole number, never below 0. An exact copy scores 100. The four category totals are rounded so they add up exactly to your score. The grader is a fixed formula with no judgement calls: the same drawing always gets the same score.`);
  }

  // =====================================================================================================
  // AFTERIMAGE controller: the memory eye exam UI wrapped around the doodle generator and grader.
  // Home → Look (10 s) → Blink → Draw → Grade → Results, plus Game Modes, Stats, Settings, Share and the
  // full Exam Report (the grader's scorecard).
  // =====================================================================================================
  let lastCard = null; // the most recent graded round: { grade, scene, title }
  if (!store.settings || typeof store.settings !== 'object') store.settings = {};
  const SET = store.settings;
  const SET_DEFAULTS = { sound: true, reduced: !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches), reminders: true, grid: true };
  for (const k of Object.keys(SET_DEFAULTS)) if (typeof SET[k] !== 'boolean') SET[k] = SET_DEFAULTS[k];

  const state = {
    screen: 'home', panel: null, mode: 'daily', modesTab: 'daily', level: 2, partyN: 2,
    day: dayOf(), seed: 0, scene: null, phase: 'idle', strokes: [], cur: null, tool: 'pen', history: [], future: [], hover: null,
    t0: 0, dur: 0, raf: 0, timeouts: [], result: null, reveal: 1, view: 'overlay', lastSec: -1, reminded: false,
    endless: { round: 1, best: 0 }, party: { n: 2, turn: 0, scores: [] }, freshDaily: false,
    menuOpen: false, modesOpen: false, lookX: 0, lookY: 0, blink: false, lastMouse: 0, primary: null,
  };
  const app = $('app');
  const fmt = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const newSeed = () => 100000 + Math.floor(Math.random() * 1e9);
  const dateOfDay = d => new Date(2026, 10, 1 + d);
  const roundTitle = () => state.mode === 'daily' ? `Today’s eye exam · No. ${state.day + 1}` : state.mode === 'endless' ? `Endless · chart ${state.endless.round} · ${LEVELS[state.level]}` : `Party · player ${state.party.turn + 1} of ${state.party.n} · ${LEVELS[state.level]}`;
  const examLabel = () => state.mode === 'daily' ? `TODAY'S EYE EXAM · #${state.day + 1}` : state.mode === 'endless' ? `ENDLESS · CHART ${state.endless.round} · ${LEVELS[state.level].toUpperCase()}` : `PARTY · PLAYER ${state.party.turn + 1} OF ${state.party.n}`;

  // ---------- vision tiers: the score read as an eye exam
  function tierOf(s) {
    if (s >= 90) return { label: '20/20 RECALL', line: 'Eye-conic. Nothing got past you.', reached: 6, mood: 'happy' };
    if (s >= 75) return { label: '20/40', line: 'Sharp eyes. A few lines went blurry.', reached: 5, mood: 'wide' };
    if (s >= 50) return { label: 'SEEING DOUBLE', line: 'You saw it. Mostly.', reached: 3, mood: 'dizzy' };
    return { label: 'TIME FOR GLASSES', line: 'Blurry today. Fresh chart tomorrow.', reached: 1, mood: 'glasses' };
  }
  const verdictOf = s => tierOf(s).label;

  // ---------- sound: tiny marker-squeak blips (Web Audio, optional)
  let audio = null;
  function beep(f, d) {
    if (!SET.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      audio = audio || new AC();
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + d + 0.03);
    } catch (e) { /* sound is optional */ }
  }

  // ---------- canvases
  function fitCanvas(c) {
    const r = c.getBoundingClientRect();
    if (!r.width) return null;
    const dpr = Math.min(3, window.devicePixelRatio || 1), px = Math.round(r.width * dpr);
    if (c.width !== px || c.height !== px) { c.width = px; c.height = px; }
    const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, r.width, r.width);
    return { x, size: r.width, k: r.width / N, dpr };
  }
  const gridIf = (x, size) => { if (SET.grid) drawGrid(x, size); };
  // the original in afterimage blue: visible outlines only (filled parts hide what is behind them)
  function blueLayer(size, dpr, scene, lw) {
    const off = document.createElement('canvas'); off.width = off.height = Math.round(size * dpr);
    const c = off.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = size / N, blue = tok('--blue');
    for (const p of scene.parts) {
      if (p.kind === 'dot') { partPath(c, p, k); c.fillStyle = blue; c.fill(); continue; }
      if (p.fill && !isOpen(p)) { c.save(); c.globalCompositeOperation = 'destination-out'; partPath(c, p, k); c.fill(); c.restore(); }
      paint(c, p, k, blue, null, lw);
    }
    return off;
  }
  function stamp(f, off, glow) {
    const x = f.x; x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    if (glow) { x.shadowColor = 'rgba(47,107,255,.85)'; x.shadowBlur = 14 * f.dpr; }
    x.drawImage(off, 0, 0); x.restore();
  }
  function renderLook() {
    const f = fitCanvas($('lookCanvas')); if (!f || !state.scene) return;
    gridIf(f.x, f.size); paintPicture(f.x, state.scene, f.k, lineW(f.size) * 1.2);
  }
  function renderBoard() {
    const f = fitCanvas($('board')); if (!f) return;
    gridIf(f.x, f.size);
    drawInk(f.x, state.strokes, f.k, tok('--pencil'), lineW(f.size) * 1.1);
    if (state.phase === 'draw' && state.tool === 'eraser' && state.hover) {
      const c = f.x; c.save(); c.strokeStyle = tok('--critical'); c.lineWidth = 2; c.setLineDash([5, 4]);
      c.beginPath(); c.arc(state.hover[0] * f.k, state.hover[1] * f.k, ERASE_R * f.k, 0, Math.PI * 2); c.stroke(); c.restore();
    }
  }
  function renderGlow() {
    const f = fitCanvas($('glow')); if (!f || !state.scene) return;
    stamp(f, blueLayer(f.size, f.dpr, state.scene, lineW(f.size) * 1.3), true);
  }
  function renderResult() {
    const g = state.result; if (!g || state.screen !== 'results') return;
    if (state.view === 'overlay') {
      const f = fitCanvas($('resCanvas'));
      if (f) { gridIf(f.x, f.size); drawResult(f.x, f.size, state.scene, g, state.reveal, { orig: true, ink: true, fit: false, labels: false }); }
    } else {
      const a = fitCanvas($('sideOrig')); if (a) { gridIf(a.x, a.size); stamp(a, blueLayer(a.size, a.dpr, state.scene, lineW(a.size) * 1.1), true); }
      const b = fitCanvas($('sideInk')); if (b) { gridIf(b.x, b.size); drawInk(b.x, g.ink, b.k, tok('--pencil'), lineW(b.size) * 1.1); }
    }
  }
  function renderShare() {
    const g = state.result; if (!g) return;
    const a = fitCanvas($('shOrig')); if (a) stamp(a, blueLayer(a.size, a.dpr, state.scene, Math.max(1.6, lineW(a.size))), true);
    const b = fitCanvas($('shInk')); if (b) drawInk(b.x, g.ink, b.k, tok('--pencil'), Math.max(1.6, lineW(b.size)));
  }
  function repaintVisible() {
    if (state.screen === 'look') renderLook();
    if (state.screen === 'draw') renderBoard();
    if (state.screen === 'results') renderResult();
    if (state.panel === 'share') renderShare();
    if (state.panel === 'scorecard') { renderMap(); document.querySelectorAll('#overlay .scale').forEach(fitLabels); }
    document.querySelectorAll('#resScale .scale').forEach(fitLabels);
  }

  // ---------- the eye mascot
  const EYE_SHAPES = { open: [-4, 104], wide: [-24, 124], squint: [30, 72], dizzy: [-4, 104], glasses: [-4, 104] };
  function updateEye() {
    let mood = 'open', lx = state.lookX, ly = state.lookY, left = '50%', top = '24px', w = 124, rot = 0;
    const s = state.screen;
    if (state.panel) { mood = state.panel === 'share' ? 'happy' : 'open'; lx = 0; ly = 6; }
    else if (s === 'look') { mood = 'wide'; lx = 0; ly = 9; top = '16px'; }
    else if (s === 'draw') { mood = state.phase === 'grading' ? 'wide' : 'squint'; lx = 15; ly = 2; left = '0px'; top = 'calc(50% - 50px)'; w = 220; rot = -8; }
    else if (s === 'results' && state.result) { mood = tierOf(state.result.score).mood; lx = 0; ly = 2; }
    else if (s === 'lineup') mood = 'happy';
    else if (state.modesOpen) { lx = 15; ly = 9; }
    const m = $('mascot');
    m.style.left = left; m.style.top = top; m.style.width = w + 'px'; m.style.transform = `translateX(-50%) rotate(${rot}deg)`;
    const sh = EYE_SHAPES[mood] || EYE_SHAPES.open, happy = mood === 'happy', show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
    const clip = `M12 50 Q70 ${sh[0]} 128 50 Q70 ${sh[1]} 12 50 Z`;
    $('eyeUp').setAttribute('d', `M12 50 Q70 ${sh[0]} 128 50`); $('eyeLo').setAttribute('d', `M12 50 Q70 ${sh[1]} 128 50`);
    $('eyeClipPath').setAttribute('d', clip); $('eyeWhite').setAttribute('d', clip);
    show('eyeOpen', !happy); show('eyeHappy', happy); show('eyeWide', mood === 'wide'); show('eyeBrow', mood === 'squint');
    show('eyeGlasses', mood === 'glasses'); show('eyeGhost', mood === 'dizzy');
    $('eyeIris').setAttribute('r', mood === 'wide' ? 17 : 19); $('eyePupil').setAttribute('r', mood === 'wide' ? 6 : mood === 'squint' ? 10 : 9);
    $('eyeMain').setAttribute('transform', mood === 'dizzy' ? 'translate(6 0)' : '');
    $('eyeLook').style.transform = `translate(${lx}px, ${ly}px)`;
    $('eyeOpen').setAttribute('transform', state.blink && !happy && !SET.reduced ? 'translate(0 50) scale(1 0.06) translate(0 -50)' : '');
  }
  (function blinkLoop() {
    setTimeout(() => {
      if (!SET.reduced && !app.classList.contains('lids-closed')) { state.blink = true; updateEye(); setTimeout(() => { state.blink = false; updateEye(); }, 150); }
      blinkLoop();
    }, 2200 + Math.random() * 2600);
  })();
  setInterval(() => {
    if (SET.reduced || state.screen !== 'home' || state.panel || Date.now() - state.lastMouse < 2500) return;
    state.lookX = Math.round((Math.random() * 2 - 1) * 14); state.lookY = Math.round((Math.random() * 2 - 1) * 8); updateEye();
  }, 1700);
  app.addEventListener('mousemove', e => {
    if (state.screen !== 'home' || state.panel || SET.reduced) return;
    const now = Date.now(); if (now - state.lastMouse < 60) return; state.lastMouse = now;
    const r = app.getBoundingClientRect(), dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + 70)) / Math.max(300, window.innerHeight * 0.6);
    state.lookX = Math.round(Math.max(-1, Math.min(1, dx)) * 15); state.lookY = Math.round(Math.max(-1, Math.min(1, dy)) * 9); updateEye();
  });

  // ---------- screens and timers
  function clearTimers() { cancelAnimationFrame(state.raf); state.raf = 0; state.timeouts.forEach(clearTimeout); state.timeouts = []; }
  const later = (fn, ms) => { state.timeouts.push(setTimeout(fn, ms)); };
  function show(screen) {
    state.screen = screen; app.dataset.screen = screen;
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.dataset.screen !== screen; });
    window.scrollTo(0, 0); updateEye();
  }
  function syncSettingsClass() { app.classList.toggle('reduced', !!SET.reduced); }
  const reduceMotion = () => !!SET.reduced;

  // ---------- home: title, streak, menu and the game modes panel
  const MODE_DESC = { daily: 'One chart a day. Everyone gets the same doodle.', endless: 'Chart after chart. See how long your eyes hold out.', party: 'Pass the mouse. Same doodle, 2–4 players, one winner.' };
  const MODE_NAME = { daily: 'Daily', endless: 'Endless', party: 'Party' };
  function syncHome() {
    $('modeLine').textContent = state.mode === 'daily' ? `TODAY'S EYE EXAM · #${dayOf() + 1}` : state.mode === 'endless' ? `ENDLESS · ${LEVELS[state.level].toUpperCase()}` : `PARTY · ${state.partyN} PLAYERS · ${LEVELS[state.level].toUpperCase()}`;
    $('titleBtn').setAttribute('aria-label', `AFTERIMAGE. Start ${state.mode === 'daily' ? "today's eye exam" : MODE_NAME[state.mode] + ' mode'}`);
    $('homeStreak').textContent = statsAll().streak;
    $('menu').hidden = !state.menuOpen; $('menuBtn').setAttribute('aria-expanded', String(state.menuOpen));
    $('menuIcon').setAttribute('d', state.menuOpen ? 'M10 10 Q20 19 30 30 M30 10 Q21 20 10 30' : 'M7 12 Q20 10 33 12 M7 20 Q21 21 33 19 M7 28 Q19 27 33 29');
    $('modesPanel').hidden = !state.modesOpen; $('modesBtn').setAttribute('aria-expanded', String(state.modesOpen));
    $('modesBtn').textContent = state.modesOpen ? 'CLOSE' : 'GAME MODES';
    document.querySelectorAll('.mtab').forEach(b => { const k = b.dataset.tab; b.setAttribute('aria-selected', String(k === state.modesTab)); b.classList.toggle('current', k === state.mode); });
    $('modeDesc').textContent = MODE_DESC[state.modesTab];
    $('levelPick').hidden = state.modesTab === 'daily'; $('partyPick').hidden = state.modesTab !== 'party';
    document.querySelectorAll('#levelPick .chip').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.level) === state.level)));
    $('partyN').textContent = state.partyN;
    $('playModeLabel').textContent = state.modesTab === 'daily' && state.dailyDoneToday ? 'SEE TODAY’S RESULT' : `PLAY ${MODE_NAME[state.modesTab].toUpperCase()}`;
    updateEye();
  }
  $('titleBtn').addEventListener('click', () => startMode(state.mode));
  $('menuBtn').addEventListener('click', () => { state.menuOpen = !state.menuOpen; state.modesOpen = false; syncHome(); });
  $('modesBtn').addEventListener('click', () => { state.modesOpen = !state.modesOpen; state.menuOpen = false; state.modesTab = state.mode; refreshDailyDone(); syncHome(); });
  document.querySelectorAll('.mtab').forEach(b => b.addEventListener('click', () => { state.modesTab = b.dataset.tab; syncHome(); }));
  document.querySelectorAll('#levelPick .chip').forEach(b => b.addEventListener('click', () => { state.level = Number(b.dataset.level); syncHome(); }));
  $('partyMinus').addEventListener('click', () => { state.partyN = Math.max(2, state.partyN - 1); syncHome(); });
  $('partyPlus').addEventListener('click', () => { state.partyN = Math.min(4, state.partyN + 1); syncHome(); });
  $('playModeBtn').addEventListener('click', () => startMode(state.modesTab));
  const refreshDailyDone = () => { const d = dayOf(), rec = store.days[d]; state.dailyDoneToday = !!(rec && rec.v === 5 && rec.seed === dailySeed(d)); };

  // ---------- modes
  function startMode(m) { if (m === 'endless') startEndless(); else if (m === 'party') startParty(); else startDaily(); }
  function startDaily() {
    clearTimers();
    Object.assign(state, { mode: 'daily', day: dayOf(), level: 2 });
    state.seed = dailySeed(state.day); state.scene = G.makeDoodle(state.seed, state.level);
    const rec = store.days[state.day];
    if (rec && rec.v === 5 && rec.seed === state.seed && Array.isArray(rec.strokes)) {
      try {
        state.strokes = tidy(rec.strokes);
        const g = gradeOf(state.scene, state.strokes);
        state.result = g; lastCard = { grade: g, scene: state.scene, title: roundTitle() };
        state.freshDaily = false; state.menuOpen = false; state.modesOpen = false; setPanel(null);
        showResults(false); return;
      } catch (e) { /* a broken record: play it fresh */ }
    }
    beginLook();
  }
  function startEndless() {
    Object.assign(state, { mode: 'endless', endless: { round: 1, best: 0 } });
    state.seed = newSeed(); state.scene = G.makeDoodle(state.seed, state.level); beginLook();
  }
  function nextEndless() {
    state.endless.round++; state.seed = newSeed(); state.scene = G.makeDoodle(state.seed, state.level); beginLook();
  }
  function startParty() {
    Object.assign(state, { mode: 'party', party: { n: state.partyN, turn: 0, scores: [] } });
    state.seed = newSeed(); state.scene = G.makeDoodle(state.seed, state.level); beginLook();
  }
  function nextTurn() { state.party.turn++; beginLook(); }
  function rematch() { state.party = { n: state.party.n, turn: 0, scores: [] }; state.seed = newSeed(); state.scene = G.makeDoodle(state.seed, state.level); beginLook(); }
  function goHome() {
    clearTimers(); pointer = null; eraseRun = null; state.phase = 'idle';
    app.classList.remove('lids-closed'); setPanel(null); refreshDailyDone(); show('home'); syncHome();
  }
  function otherModes() { goHome(); state.modesOpen = true; state.modesTab = state.mode; syncHome(); }
  document.querySelectorAll('[data-act="home"]').forEach(b => b.addEventListener('click', goHome));

  // ---------- round flow: look (10 s) → blink → draw → grading → results
  function beginLook() {
    clearTimers();
    Object.assign(state, { strokes: [], cur: null, history: [], future: [], hover: null, result: null, reveal: 1, view: 'overlay', tool: 'pen', lastSec: -1, reminded: false, menuOpen: false, modesOpen: false });
    pointer = null; eraseRun = null;
    store.seenHelp = true; writeStore();
    setPanel(null); app.classList.remove('lids-closed');
    $('lookLabel').textContent = examLabel();
    $('lookCaption').textContent = state.scene.caption;
    $('lookHint').textContent = '';
    state.phase = 'look'; show('look');
    renderLook(); requestAnimationFrame(renderLook);
    state.t0 = performance.now(); state.dur = LOOK_MS; setCount(10); beep(520, 0.12);
    state.raf = requestAnimationFrame(loop);
  }
  function setCount(n) {
    const el = $('cdNum'); el.textContent = n; el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
    const wide = n <= 3;
    $('cdEye').setAttribute('d', `M10 65 Q100 ${wide ? -26 : -6} 190 65 Q100 ${wide ? 156 : 136} 10 65 Z`);
    $('cdWrap').setAttribute('aria-label', `${n} seconds to memorize`);
    $('lookHint').textContent = n === 1 ? 'Don’t blink…' : n <= 3 && n > 0 ? 'Lock it in.' : '';
  }
  function loop(now) {
    if (state.phase === 'look') {
      const left = Math.max(0, state.dur - (now - state.t0)), sec = Math.ceil(left / 1000);
      if (sec !== state.lastSec) { state.lastSec = sec; if (sec < 10) setCount(sec); if (sec > 0 && sec <= 3) beep(660, 0.08); }
      if (left <= 0) { state.raf = 0; blinkToDraw(); return; }
    } else if (state.phase === 'draw') {
      const left = Math.max(0, state.dur - (now - state.t0)), hurry = left <= 10000 && SET.reminders;
      $('timerTag').textContent = fmt(Math.min(state.dur, left));
      if (hurry && !state.reminded) { state.reminded = true; beep(440, 0.18); }
      $('timerTag').classList.toggle('pulse', hurry); $('reminder').hidden = !hurry;
      if (left <= 0) { state.raf = 0; finish(); return; }
    } else { state.raf = 0; return; }
    state.raf = requestAnimationFrame(loop);
  }
  function blinkToDraw() {
    if (state.phase !== 'look') return;
    cancelAnimationFrame(state.raf); state.raf = 0; state.phase = 'blink'; beep(240, 0.3);
    if (reduceMotion()) { toDraw(false); return; }
    app.classList.add('lids-closed');
    later(() => toDraw(true), 560);
  }
  function toDraw(animated) {
    Object.assign(state, { phase: 'draw', strokes: [], cur: null, history: [], future: [], hover: null, tool: 'pen', reminded: false });
    pointer = null; eraseRun = null;
    $('drawLabel').textContent = examLabel(); $('grading').hidden = true; $('reminder').hidden = true;
    $('timerTag').classList.remove('pulse'); $('timerTag').textContent = fmt(DRAW_MS[state.level]);
    show('draw'); setTool('pen'); renderBoard();
    // the afterimage: the drawing lingers in glowing blue, then fades
    const glow = $('glow'); glow.style.transition = 'none'; glow.style.opacity = '0.95'; renderGlow(); void glow.offsetWidth; glow.style.transition = '';
    later(() => app.classList.remove('lids-closed'), animated ? 140 : 0);
    later(() => { glow.style.opacity = '0'; }, animated ? 760 : 500);
    later(() => { state.t0 = performance.now(); state.dur = DRAW_MS[state.level]; state.raf = requestAnimationFrame(loop); }, animated ? 480 : 0);
  }
  function finish() {
    if (state.phase !== 'draw') return;
    clearTimers(); pointer = null; eraseRun = null; state.cur = null; state.hover = null;
    state.phase = 'grading'; $('grading').hidden = false; $('reminder').hidden = true; $('timerTag').classList.remove('pulse');
    renderBoard(); updateEye();
    setTimeout(gradeNow, 60);
  }
  $('skipLookBtn').addEventListener('click', blinkToDraw);
  $('doneBtn').addEventListener('click', finish);

  function gradeNow() {
    state.strokes = tidy(state.strokes);
    let g;
    try { g = gradeOf(state.scene, state.strokes); } catch (e) { console.error(e); $('grading').firstElementChild.textContent = 'The grader slipped. Try another chart.'; return; }
    state.result = g; lastCard = { grade: g, scene: state.scene, title: roundTitle() };
    if (state.mode === 'daily') { store.days[state.day] = { v: 5, seed: state.seed, level: state.level, score: g.score, strokes: state.strokes }; writeStore(); state.freshDaily = true; }
    if (state.mode === 'endless') state.endless.best = Math.max(state.endless.best, g.score);
    if (state.mode === 'party') state.party.scores[state.party.turn] = g.score;
    beep(g.score >= 75 ? 880 : 520, 0.35);
    showResults(true);
  }

  // ---------- results
  function showResults(animated) {
    const g = state.result, t = tierOf(g.score), daily = state.mode === 'daily';
    state.phase = 'graded'; show('results');
    $('resKicker').textContent = state.mode === 'party' ? `PLAYER ${state.party.turn + 1} · EXAM RESULTS` : daily ? `EXAM RESULTS · #${state.day + 1}` : `ENDLESS · CHART ${state.endless.round}`;
    document.querySelectorAll('#eyeChart .chart-row').forEach((row, i) => {
      const ok = i < t.reached, ltr = row.querySelector('.ltr');
      row.classList.toggle('mark', i === t.reached - 1);
      ltr.style.filter = ok ? '' : `blur(${((i - t.reached + 1) * 1.6 + 1).toFixed(1)}px)`; ltr.style.opacity = ok ? '1' : '0.55';
    });
    $('eyeChart').setAttribute('aria-label', `Eye chart read down to the ${['20/200', '20/100', '20/70', '20/50', '20/40', '20/20'][t.reached - 1]} line`);
    $('tierLabel').textContent = t.label; $('scorePct').textContent = `${g.score}% match`; $('tierLine').textContent = t.line;
    const graded = g.rows.filter(r => r.graded), missed = graded.filter(r => !r.found).length;
    $('resExplain').textContent = !g.ink.length ? 'Nothing was drawn, so nothing could match.'
      : `${state.scene.caption}. You found ${graded.length - missed} of its ${graded.length} parts.${missed ? ' Yellow marks what you missed.' : ''}${g.penalty > 0 ? ` Red dashes: ink that draws nothing (−${one(g.penalty)}).` : ' No stray ink.'}`;
    const note = daily && !state.freshDaily ? 'Today’s exam is already on file. Keep training in Endless, or come back tomorrow.'
      : state.mode === 'endless' ? `Best this run: ${state.endless.best}%` : '';
    $('resNote').textContent = note; $('resNote').hidden = !note;
    renderScale($('resScale'), scaleParts(g), 'Where your 100 points went', scaleAria(g));
    if (daily) { $('primaryBtn').textContent = 'PLAY ENDLESS'; state.primary = startEndless; }
    else if (state.mode === 'endless') { $('primaryBtn').textContent = 'NEXT CHART'; state.primary = nextEndless; }
    else if (state.party.turn < state.party.n - 1) { $('primaryBtn').textContent = `PASS TO PLAYER ${state.party.turn + 2}`; state.primary = nextTurn; }
    else { $('primaryBtn').textContent = 'SEE THE LINEUP'; state.primary = showLineup; }
    const k = statsAll();
    $('resStreak').textContent = `${k.streak} DAY STREAK`;
    $('nextLine').hidden = !daily; tick();
    setView('overlay');
    if (animated) $('announce').textContent = `Scored ${g.score} percent: ${t.label}.`;
    state.freshDaily = false;
    if (!animated || reduceMotion()) { state.reveal = 1; requestAnimationFrame(renderResult); return; }
    const t0 = performance.now(), D = 1800;
    const step = now => { if (state.screen !== 'results' || state.result !== g) return; state.reveal = Math.min(1, (now - t0) / D); renderResult(); if (state.reveal < 1) requestAnimationFrame(step); };
    state.reveal = 0; requestAnimationFrame(step);
  }
  function setView(v) {
    state.view = v;
    $('vOverlay').setAttribute('aria-pressed', String(v === 'overlay')); $('vSide').setAttribute('aria-pressed', String(v === 'side'));
    $('resOverlayWrap').hidden = v !== 'overlay'; $('resSideWrap').hidden = v !== 'side';
    renderResult(); requestAnimationFrame(renderResult);
  }
  $('vOverlay').addEventListener('click', () => setView('overlay'));
  $('vSide').addEventListener('click', () => setView('side'));
  $('primaryBtn').addEventListener('click', () => { if (state.primary) state.primary(); });
  $('shareBtn').addEventListener('click', () => setPanel('share'));
  $('reportBtn').addEventListener('click', () => setPanel('scorecard'));
  $('otherModesBtn').addEventListener('click', otherModes);

  function showLineup() {
    const list = $('lineupList'); list.textContent = '';
    const rows = state.party.scores.map((s, i) => ({ name: `Player ${i + 1}`, score: s || 0 })).sort((a, b) => b.score - a.score);
    rows.forEach((p, i) => {
      const li = mk('li'), who = mk('span', 'who');
      who.append(mk('b', '', p.name), mk('span', '', tierOf(p.score).label));
      li.append(mk('span', 'rank', String(i + 1)), who, mk('span', 'pts', `${p.score}%`));
      list.appendChild(li);
    });
    $('winner').textContent = rows.length ? `Eagle eye: ${rows[0].name}` : '';
    state.phase = 'idle'; show('lineup');
  }
  $('rematchBtn').addEventListener('click', rematch);
  $('lineupModesBtn').addEventListener('click', otherModes);

  // ---------- freehand input: pen strokes and the eraser, in grid units (strokes kept exactly as drawn)
  const board = $('board');
  function toBoard(e) { const r = board.getBoundingClientRect(); return [Math.min(N, Math.max(0, ((e.clientX - r.left) / r.width) * N)), Math.min(N, Math.max(0, ((e.clientY - r.top) / r.height) * N))]; }
  const snapshot = () => state.strokes.slice();
  let pointer = null, eraseRun = null;
  board.addEventListener('pointerdown', e => {
    if (state.phase !== 'draw' || pointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
    pointer = e.pointerId;
    const p = toBoard(e);
    if (state.tool === 'pen') { state.history.push(snapshot()); state.future = []; state.cur = [p]; state.strokes.push(state.cur); }
    else { eraseRun = { before: snapshot(), changed: eraseAlong(p, p), last: p }; state.hover = p; }
    renderBoard(); updateTools();
  });
  board.addEventListener('pointermove', e => {
    if (state.phase !== 'draw') return;
    if (pointer === null || e.pointerId !== pointer) { if (e.pointerType !== 'touch' && state.tool === 'eraser') { state.hover = toBoard(e); renderBoard(); } return; }
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const p = toBoard(ev);
      if (state.tool === 'pen' && state.cur) { const last = state.cur[state.cur.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= MOVE_MIN) state.cur.push(p); }
      else if (eraseRun) { if (eraseAlong(eraseRun.last, p)) eraseRun.changed = true; eraseRun.last = p; state.hover = p; }
    }
    renderBoard();
  });
  const endStroke = e => {
    if (pointer === null || (e && e.pointerId !== pointer)) return;
    pointer = null; state.cur = null;
    if (eraseRun) { if (eraseRun.changed) { state.history.push(eraseRun.before); state.future = []; } eraseRun = null; }
    if (e && e.pointerType === 'touch') state.hover = null;
    renderBoard(); updateTools();
  };
  board.addEventListener('pointerup', endStroke);
  board.addEventListener('pointercancel', endStroke);
  board.addEventListener('lostpointercapture', endStroke);
  board.addEventListener('pointerleave', () => { if (pointer === null && state.hover) { state.hover = null; renderBoard(); } });

  function setTool(t) {
    state.tool = t; if (t !== 'eraser') state.hover = null;
    $('boardWrap').classList.toggle('erasing', t === 'eraser');
    updateTools(); renderBoard();
  }
  function undo() { if (state.phase !== 'draw' || !state.history.length || pointer !== null) return; state.future.push(snapshot()); state.strokes = state.history.pop(); renderBoard(); updateTools(); }
  function redo() { if (state.phase !== 'draw' || !state.future.length || pointer !== null) return; state.history.push(snapshot()); state.strokes = state.future.pop(); renderBoard(); updateTools(); }
  function clearAll() { if (state.phase !== 'draw' || !state.strokes.length || pointer !== null) return; state.history.push(snapshot()); state.future = []; state.strokes = []; renderBoard(); updateTools(); }
  function updateTools() {
    $('penBtn').setAttribute('aria-pressed', String(state.tool === 'pen')); $('eraserBtn').setAttribute('aria-pressed', String(state.tool === 'eraser'));
    $('undoBtn').disabled = !state.history.length; $('redoBtn').disabled = !state.future.length; $('clearBtn').disabled = !state.strokes.length;
    const n = state.strokes.length;
    board.setAttribute('aria-label', `Drawing board, 20 by 20 units. ${state.tool === 'pen' ? 'Pen' : 'Eraser'}, ${n} stroke${n === 1 ? '' : 's'}.`);
  }
  $('penBtn').addEventListener('click', () => setTool('pen'));
  $('eraserBtn').addEventListener('click', () => setTool('eraser'));
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('clearBtn').addEventListener('click', clearAll);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (state.panel) { setPanel(null); return; } if (state.menuOpen || state.modesOpen) { state.menuOpen = false; state.modesOpen = false; syncHome(); } return; }
    if (state.phase !== 'draw' || state.panel) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'e' || e.key === 'E') setTool('eraser');
    else if (e.key === 'p' || e.key === 'P' || e.key === 'b' || e.key === 'B') setTool('pen');
  });

  // ---------- overlays: how to play, stats, settings, share, exam report
  const PANEL_NAMES = { how: 'How to play', stats: 'Stats', settings: 'Settings', share: 'Share your result', scorecard: 'Exam report' };
  let panelReturn = null;
  function setPanel(name) {
    if (name === 'share' && !state.result) name = null;
    const was = state.panel; state.panel = name || null;
    $('overlay').hidden = !name; $('overlay').setAttribute('aria-label', PANEL_NAMES[name] || 'Panel');
    document.querySelectorAll('.panel-view').forEach(p => { p.hidden = p.dataset.panel !== name; });
    if (name) {
      if (!was) panelReturn = document.activeElement;
      state.menuOpen = false; state.modesOpen = false; if (state.screen === 'home') syncHome();
      $('overlay').scrollTop = 0;
      if (name === 'stats') renderStats();
      if (name === 'settings') syncSettings();
      if (name === 'share') fillShare();
      if (name === 'scorecard') { renderScorecard(); requestAnimationFrame(() => { document.querySelectorAll('#overlay .scale').forEach(fitLabels); renderMap(); }); }
      $('closePanel').focus({ preventScroll: true });
    } else if (was) {
      if (was === 'how') { store.seenHelp = true; writeStore(); }
      if (panelReturn && document.contains(panelReturn) && !panelReturn.closest('[hidden]')) panelReturn.focus({ preventScroll: true });
      panelReturn = null;
    }
    updateEye();
  }
  $('closePanel').addEventListener('click', () => setPanel(null));
  document.querySelectorAll('[data-act="close"]').forEach(b => b.addEventListener('click', () => setPanel(null)));
  document.querySelectorAll('[data-panel]').forEach(b => { if (b.tagName === 'BUTTON') b.addEventListener('click', () => setPanel(b.dataset.panel)); });
  $('goPlayBtn').addEventListener('click', () => { setPanel(null); startDaily(); });

  function statsAll() {
    const days = Object.keys(store.days).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const scores = days.map(d => Number(store.days[d].score) || 0), played = days.length;
    let streak = 0, d = store.days[dayOf()] ? dayOf() : dayOf() - 1;
    while (store.days[d]) { streak++; d--; }
    let longest = 0, run = 0, prev = null;
    for (const x of days) { run = prev !== null && x === prev + 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = x; }
    return { days, played, avg: played ? Math.round(scores.reduce((a, b) => a + b, 0) / played) : 0, best: played ? Math.max(...scores) : 0, streak, longest };
  }
  function renderStats() {
    const k = statsAll();
    $('stPlayed').textContent = k.played; $('stAvg').textContent = k.played ? `${k.avg}%` : '–'; $('stBest').textContent = k.played ? `${k.best}%` : '–';
    $('stStreak').textContent = k.streak; $('stLongest').textContent = k.longest;
    const last = k.days.slice(-7), bars = $('bars'), labels = $('barDays'), today = dayOf();
    bars.textContent = ''; labels.textContent = '';
    $('weekEmpty').hidden = last.length > 0; bars.hidden = !last.length; labels.hidden = !last.length;
    const aria = [];
    last.forEach(d => {
      const s = Number(store.days[d].score) || 0, b = mk('div', 'bar' + (d === today ? ' today' : '')), i = mk('i');
      i.style.height = `${Math.max(10, Math.round(s * 1.7))}px`;
      b.append(mk('b', '', String(s)), i); bars.appendChild(b);
      const name = d === today ? 'Today' : DAYS[dateOfDay(d).getDay()];
      labels.appendChild(mk('span', '', name)); aria.push(`${name} ${s}%`);
    });
    bars.setAttribute('aria-label', `Last ${last.length} daily scores: ${aria.join(', ')}`);
  }
  function syncSettings() { document.querySelectorAll('.switch').forEach(b => b.setAttribute('aria-checked', String(!!SET[b.dataset.set]))); }
  document.querySelectorAll('.switch').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.set; SET[k] = !SET[k]; writeStore(); syncSettings(); syncSettingsClass();
    if (k === 'grid') repaintVisible();
    if (k === 'sound' && SET.sound) beep(660, 0.1);
  }));

  function shareText() {
    const g = state.result, sc = state.scene, t = tierOf(g.score);
    const head = state.mode === 'daily' ? `AFTERIMAGE #${state.day + 1} · ${t.label} · ${g.score}%` : state.mode === 'endless' ? `AFTERIMAGE Endless (${LEVELS[state.level]}) · ${t.label} · ${g.score}%` : `AFTERIMAGE Party (${LEVELS[state.level]}) · ${t.label} · ${g.score}%`;
    const line = sc.groups.map(o => (EMOJI[o.id] || '▫️') + g.rows.filter(r => r.graded && r.object === o.id).map(square).join('')).join(' ');
    return `${head}\n${line}${g.penalty > 0 ? `\n✏️ −${one(g.penalty)} for extra ink` : ''}\ndon't blink or you'll miss it.`;
  }
  function fillShare() {
    const g = state.result, t = tierOf(g.score), k = statsAll();
    $('shKicker').textContent = `MEMORY EYE EXAM · ${state.mode === 'daily' ? `DAILY #${state.day + 1}` : state.mode === 'endless' ? `ENDLESS CHART ${state.endless.round}` : 'PARTY'}`;
    const now = new Date(); $('shDate').textContent = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`.toUpperCase();
    $('shTier').textContent = t.label; $('shScore').textContent = `${g.score}%`; $('shStreak').textContent = `STREAK · ${k.streak} DAY${k.streak === 1 ? '' : 'S'}`;
    $('shareText').textContent = shareText(); $('shareText').hidden = true; $('copyStatus').textContent = ''; $('copyBtn').textContent = 'COPY RESULT';
    requestAnimationFrame(renderShare);
  }
  $('copyBtn').addEventListener('click', () => {
    const text = shareText(), btn = $('copyBtn');
    const fallback = () => {
      const pre = $('shareText'); pre.hidden = false;
      const range = document.createRange(); range.selectNodeContents(pre); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      $('copyStatus').textContent = 'Copying is blocked here. It’s selected below: copy it yourself.';
    };
    try { navigator.clipboard.writeText(text).then(() => { btn.textContent = 'COPIED'; $('copyStatus').textContent = 'Copied. Go show off those eyes.'; setTimeout(() => { btn.textContent = 'COPY RESULT'; }, 1800); }, fallback); } catch (e) { fallback(); }
  });

  // ---------- clock: countdown to tomorrow's exam
  function tick() {
    const now = new Date(), next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const t = Math.max(0, Math.floor((next - now) / 1000)), p2 = n => String(n).padStart(2, '0');
    $('nextIn').textContent = `${p2(Math.floor(t / 3600))}:${p2(Math.floor((t % 3600) / 60))}:${p2(t % 60)}`;
    if (state.screen === 'home' && !state.panel) { const line = `TODAY'S EYE EXAM · #${dayOf() + 1}`; if (state.mode === 'daily' && $('modeLine').textContent !== line) syncHome(); }
  }

  // ---------- boot
  function start() {
    syncSettingsClass(); refreshDailyDone();
    state.day = dayOf(); show('home'); syncHome(); renderScorecard();
    if ('ResizeObserver' in window) new ResizeObserver(() => repaintVisible()).observe(document.documentElement);
    window.addEventListener('resize', repaintVisible);
    try { window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => { if (!('reducedSetByUser' in store)) { SET.reduced = e.matches; syncSettingsClass(); } }); } catch (e) { /* older browsers */ }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(repaintVisible);
    if (!store.seenHelp && !Object.keys(store.days).length) setPanel('how');
    tick(); setInterval(tick, 1000);
  }
  start();

})();
