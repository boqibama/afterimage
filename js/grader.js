// Afterimage grader. Scores a freehand drawing against a structured doodle from doodles.js, component by component,
// with explicit geometry: no pixel comparison and no learned judgement. Board: 20 x 20 units, x right, y down, angles
// in degrees, clockwise.
//
// 1. Reference. Every component's outline is sampled every 0.08 units and the samples covered by components drawn
//    over it are dropped, leaving its visible outline. Each component gets an importance weight
//      W = I(need) * clamp(sqrt(size / size of its object's root), 0.5, 1) * O(object kind)
//    with I = 3 silhouette, 2 signature feature, 1 detail, 0.5 minor detail; O = 1 character, 0.7 worn, held or
//    ridden things, 0.5 scenery. size = sqrt(w * h) (a line's or dot's: its length or diameter).
// 2. Ink. The strokes are kept as drawn, resampled every 0.05 units and put in a canonical order and direction, so
//    stroke order and direction change nothing. Six distance fields, one per stroke direction (30-degree bins), make
//    every match direction-aware: ink only supports an outline it runs along (within 45 degrees).
// 3. Objects first. Each object (the pig, its crown, the bicycle) is placed by sliding, scaling and turning its
//    visible outline over the ink until it is best covered (soft coverage within 0.7 units, with a mild pull towards
//    where it should be). Characters go first; worn, held and ridden things are searched near where their character
//    puts them; ink near a placed object is reserved for it.
// 4. Components. Inside each object every component is fitted from where the object places it: its centre, width,
//    height and turn are free (coverage of its visible outline within 2 tau, tau = 0.25 + 0.06 * size). Look-alike
//    siblings (two legs, two eyes) are assigned one to one with the Hungarian method, and dots are matched one to one
//    with small marks near where their parent says they belong (within 45% of the parent's size).
// 5. Evidence. Each bit of ink belongs to the fitted outline it lies on (within tau and 50 degrees of its direction).
//    A component is found when its own ink covers at least 45% of its visible outline and the ink crossing it is no
//    more than 1.5 times its own. Missing components earn nothing.
// 6. Credits for a found component:
//    Shape 40%     The reference outline is placed by translation, turn and uniform scale only (so size and position
//                  do not count here) and E = (mean ink-to-outline + mean visible-outline-to-ink distance) / 2 / size.
//                  credit = kappa * ramp(E: 1 at 0.04, 0 at 0.25). kappa = ramp(r: 1 at 1.15, 0 at 1.6), where r is
//                  how much worse the reference's kind fits the ink than the best other kind (ellipse, rectangle,
//                  triangle, half-oval). Thin bars may be drawn as one line. A dot is any small mark.
//    Size 25%      rho = smaller / larger of the drawn and reference width, and of the heights: each 1 at 0.9 or
//                  above, 0 at 0.45, multiplied. Lines: length. Dots: 1 for 0.4x to 2.5x the diameter, 0 at 0.15x/5x.
//    Position 20%  Half is the object's placement (its centre offset: 1 within 0.25 units, 0 at 5); half is the
//                  component's offset from its parent compared with the reference offset at the object's scale and
//                  turn (1 within 8% of the parent's size, 0 at 60%). An object's root counts placement only.
//    Turn 15%      turn error modulo the shape's symmetry (none for circles and dots; 180 for ovals, rectangles and
//                  lines; 90 for squares; 120 for equilateral triangles; 360 otherwise): 1 within 5 degrees, 0 at 45.
// 7. Score = 100 * sum(W * credit) / sum(W), so an exact copy scores 100, then minus 0.5 points a unit of ink that no
//    component explains, after 2 free units, up to 25.
(function (root) {
  'use strict';

  const BOARD = 20, CELL = 0.1, N = 200, BINS = 6;
  const RUBRIC = [
    { key: 'shape', name: 'Shape', weight: 40 },
    { key: 'size', name: 'Size', weight: 25 },
    { key: 'position', name: 'Position', weight: 20 },
    { key: 'orientation', name: 'Orientation', weight: 15 },
  ];
  const IMPORTANCE = { 1: 3, 2: 2, 3: 1, 4: 0.5 };
  const OBJECT_WEIGHT = { character: 1, accessory: 0.7, ride: 0.7, scenery: 0.5 };
  const RULES = {
    sample: 0.08, inkStep: 0.05, tap: 0.15, dotMax: 1.2,
    tau: [0.25, 0.06], align: 50, near: 0.1, share: 0.15,
    found: 0.45, clutter: 1.5, objectFound: 0.25, delta: 0.7, run: [0.25, 0.5, 1.5], join: 0.35, kindFound: 0.5,
    shape: [0.04, 0.25], kind: [1.15, 1.6], bar: [0.9, 3.5],
    size: [0.9, 0.45], slack: 0.3, dot: [0.4, 2.5, 0.15, 5], dotReach: 0.45, endSlip: 0.2,
    place: [0.25, 5], rel: [0.08, 0.6], turn: [5, 45],
    inkFree: 2, inkRate: 0.75, inkCap: 40, drift: [0.3, 0.6, 0.8], sizeRange: [0.45, 2.2], aspectRange: 3, duplicate: [0.12, 0.6],
  };

  // ---------- small helpers
  const rad = d => (d * Math.PI) / 180, deg = a => (a * 180) / Math.PI;
  const wrap = (a, p) => { const h = p / 2; return ((((a + h) % p) + p) % p) - h; };
  const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
  // 1 at `full`, 0 at `zero`, linear between (works for errors, where full < zero, and for ratios, where full > zero)
  const ramp = (v, full, zero) => clamp01((v - zero) / (full - zero));
  const ellPerim = (a, b) => { const H = ((a - b) / (a + b)) ** 2; return Math.PI * (a + b) * (1 + (3 * H) / (10 + Math.sqrt(4 - 3 * H))); };
  const tauOf = L => RULES.tau[0] + RULES.tau[1] * L;
  const thin = (arr, n) => { if (arr.length <= n) return arr; const out = [], step = arr.length / n; for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]); return out; };

  // ---------- geometry of the primitives
  function poseOf(p) {
    if (p.kind === 'line') return { kind: 'line', x: p.x, y: p.y, w: p.w, h: 0, r: p.r };
    return { kind: p.kind, x: p.x, y: p.y, w: p.w, h: p.h, r: p.r, a0: p.a0, a1: p.a1 };
  }
  const sizeOf = q => (q.kind === 'line' || q.kind === 'dot' ? q.w : Math.sqrt(Math.max(0.01, q.w * q.h)));
  function perimeter(q) {
    const a = Math.max(q.w / 2, 1e-3), b = Math.max(q.h / 2, 1e-3);
    if (q.kind === 'line') return q.w;
    if (q.kind === 'ellipse' || q.kind === 'dot') return ellPerim(a, b);
    if (q.kind === 'arc') return (ellPerim(a, b) * Math.abs(q.a1 - q.a0)) / 360;
    if (q.kind === 'rect') return 2 * (q.w + q.h);
    if (q.kind === 'tri') return q.w + 2 * Math.hypot(q.w / 2, q.h);
    return ellPerim(a, Math.max(q.h, 1e-3)) / 2 + q.w;
  }
  const polyOf = (kind, w, h) => { const a = w / 2, b = h / 2; return kind === 'rect' ? [[-a, -b], [a, -b], [a, b], [-a, b]] : [[0, -b], [a, b], [-a, b]]; };
  // points on a component's outline at parameters ts (0..1), in board units, with the outline's direction there
  function samplesAt(q, ts) {
    const c = Math.cos(rad(q.r)), s = Math.sin(rad(q.r)), a = Math.max(q.w / 2, 1e-3), b = Math.max(q.h / 2, 1e-3), out = new Array(ts.length);
    let V = null, cum = null, Ld = 0, Lb = 0;
    if (q.kind === 'rect' || q.kind === 'tri') { V = polyOf(q.kind, q.w, q.h); cum = [0]; for (let i = 0; i < V.length; i++) { const [x0, y0] = V[i], [x1, y1] = V[(i + 1) % V.length]; cum.push(cum[i] + Math.hypot(x1 - x0, y1 - y0)); } }
    if (q.kind === 'semi') { Ld = ellPerim(a, Math.max(q.h, 1e-3)) / 2; Lb = q.w; }
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]; let lx, ly, dx, dy;
      if (q.kind === 'ellipse' || q.kind === 'dot') { const u = 2 * Math.PI * t; lx = a * Math.cos(u); ly = b * Math.sin(u); dx = -a * Math.sin(u); dy = b * Math.cos(u); }
      else if (q.kind === 'arc') { const u = rad(q.a0 + (q.a1 - q.a0) * t); lx = a * Math.cos(u); ly = b * Math.sin(u); dx = -a * Math.sin(u); dy = b * Math.cos(u); }
      else if (q.kind === 'line') { lx = (t - 0.5) * q.w; ly = 0; dx = 1; dy = 0; }
      else if (V) {
        const P = cum[cum.length - 1], sp = t * P; let k = 0;
        while (k < V.length - 1 && sp > cum[k + 1]) k++;
        const [x0, y0] = V[k], [x1, y1] = V[(k + 1) % V.length], l = cum[k + 1] - cum[k], f = l ? (sp - cum[k]) / l : 0;
        lx = x0 + (x1 - x0) * f; ly = y0 + (y1 - y0) * f; dx = x1 - x0; dy = y1 - y0;
      } else {
        const sp = t * (Ld + Lb);
        if (sp < Ld) { const u = Math.PI + (Math.PI * sp) / Ld; lx = a * Math.cos(u); ly = b + q.h * Math.sin(u); dx = -a * Math.sin(u); dy = q.h * Math.cos(u); }
        else { const f = (sp - Ld) / Lb; lx = a - 2 * a * f; ly = b; dx = -1; dy = 0; }
      }
      out[i] = [q.x + lx * c - ly * s, q.y + lx * s + ly * c, deg(Math.atan2(dx * s + dy * c, dx * c - dy * s))];
    }
    return out;
  }
  function inside(p, X, Y) {
    const c = Math.cos(rad(p.r)), s = Math.sin(rad(p.r)), dx = X - p.x, dy = Y - p.y, x = dx * c + dy * s, y = -dx * s + dy * c, a = p.w / 2, b = p.h / 2;
    if (p.kind === 'ellipse' || p.kind === 'dot') return (x * x) / (a * a) + (y * y) / (b * b) < 1;
    if (p.kind === 'rect') return Math.abs(x) < a && Math.abs(y) < b;
    if (p.kind === 'tri') return y > -b && y < b && Math.abs(x) < (a * (y + b)) / (2 * b);
    if (p.kind === 'semi') return y < b && (x * x) / (a * a) + ((y - b) * (y - b)) / (p.h * p.h) < 1;
    return false;
  }
  function segClosest(px, py, ax, ay, bx, by) { const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0; return [Math.hypot(px - ax - t * vx, py - ay - t * vy), vx, vy]; }
  // nearest point on a centred, unturned ellipse with semi-axes a, b: [distance, tangent x, tangent y, parameter angle]
  function ellClosest(a, b, px, py) {
    const ax = Math.abs(px), ay = Math.abs(py);
    let tx = 0.70710678, ty = 0.70710678;
    for (let i = 0; i < 4; i++) {
      const x = a * tx, y = b * ty, ex = ((a * a - b * b) * tx * tx * tx) / a, ey = ((b * b - a * a) * ty * ty * ty) / b;
      const rx = x - ex, ry = y - ey, qx = ax - ex, qy = ay - ey, r = Math.hypot(rx, ry), q = Math.max(1e-12, Math.hypot(qx, qy));
      tx = Math.min(1, Math.max(0, ((qx * r) / q + ex) / a)); ty = Math.min(1, Math.max(0, ((qy * r) / q + ey) / b));
      const t = Math.hypot(tx, ty) || 1; tx /= t; ty /= t;
    }
    const cx = a * tx * (px < 0 ? -1 : 1), cy = b * ty * (py < 0 ? -1 : 1);
    return [Math.hypot(px - cx, py - cy), (-cy * a) / b, (cx * b) / a, Math.atan2(cy / b, cx / a)];
  }
  // distance from a point to a component's outline, and the outline's direction at the nearest point (degrees)
  function closest(q, X, Y) {
    const c = Math.cos(rad(q.r)), s = Math.sin(rad(q.r)), dx = X - q.x, dy = Y - q.y, u = dx * c + dy * s, v = -dx * s + dy * c;
    const a = Math.max(q.w / 2, 1e-3), b = Math.max(q.h / 2, 1e-3);
    let d = Infinity, tx = 1, ty = 0;
    if (q.kind === 'line') { const k = Math.max(-q.w / 2, Math.min(q.w / 2, u)); d = Math.hypot(u - k, v); }
    else if (q.kind === 'ellipse' || q.kind === 'dot') { const e = ellClosest(a, b, u, v); d = e[0]; tx = e[1]; ty = e[2]; }
    else if (q.kind === 'arc') {
      const e = ellClosest(a, b, u, v), lo = Math.min(q.a0, q.a1), hi = Math.max(q.a0, q.a1);
      let th = deg(e[3]); while (th < lo) th += 360; while (th - 360 >= lo) th -= 360;
      if (th <= hi) { d = e[0]; tx = e[1]; ty = e[2]; }
      else {
        const d0 = Math.hypot(u - a * Math.cos(rad(lo)), v - b * Math.sin(rad(lo))), d1 = Math.hypot(u - a * Math.cos(rad(hi)), v - b * Math.sin(rad(hi))), th2 = rad(d0 < d1 ? lo : hi);
        d = Math.min(d0, d1); tx = -a * Math.sin(th2); ty = b * Math.cos(th2);
      }
    } else if (q.kind === 'rect' || q.kind === 'tri') {
      const V = polyOf(q.kind, q.w, q.h);
      for (let i = 0; i < V.length; i++) { const [x0, y0] = V[i], [x1, y1] = V[(i + 1) % V.length], r = segClosest(u, v, x0, y0, x1, y1); if (r[0] < d) { d = r[0]; tx = r[1]; ty = r[2]; } }
    } else {
      const e = ellClosest(a, Math.max(q.h, 1e-3), u, v - b), dDome = v - b <= 0 ? e[0] : Infinity, sb = segClosest(u, v, -a, b, a, b);
      if (dDome < sb[0]) { d = dDome; tx = e[1]; ty = e[2]; } else { d = sb[0]; tx = sb[1]; ty = sb[2]; }
    }
    return [d, deg(Math.atan2(tx * s + ty * c, tx * c - ty * s))];
  }
  function boxOf(q, pad) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const n = q.kind === 'line' ? 2 : 32, ts = []; for (let i = 0; i < n; i++) ts.push(q.kind === 'line' ? i : i / n);
    for (const [x, y] of samplesAt(q, ts)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  const aspect = q => Math.max(q.w, q.h) / Math.max(1e-6, Math.min(q.w, q.h));
  const isBar = q => (q.kind === 'rect' || q.kind === 'ellipse') && Math.min(q.w, q.h) <= RULES.bar[0] && aspect(q) >= RULES.bar[1];
  function equilateral(q) { const s = Math.hypot(q.w / 2, q.h); return Math.max(s, q.w) / Math.min(s, q.w) < 1.2; }

  // ---------- the reference
  const STEM = /^(left|right|upper|lower|front|back|top|bottom|small|big|middle) /;
  function referenceOf(d) {
    const P = d.parts, solid = p => p.kind !== 'line' && p.kind !== 'arc' && !(p.fill === null && p.kind !== 'dot');
    const comps = P.map((p, k) => {
      const pose = poseOf(p), closed = !(p.kind === 'line' || p.kind === 'arc');
      const n = p.kind === 'dot' ? 0 : Math.max(closed ? 24 : 8, Math.ceil(perimeter(pose) / RULES.sample));
      const ts = []; for (let i = 0; i < n; i++) ts.push(closed ? i / n : i / Math.max(1, n - 1));
      const pts = samplesAt(pose, ts), later = P.slice(k + 1).filter(solid), vis = [], visPts = [];
      ts.forEach((t, i) => { if (!later.some(q => inside(q, pts[i][0], pts[i][1]))) { vis.push(t); visPts.push(pts[i]); } });
      return { k, id: p.id, part: p.part, stem: p.part.replace(STEM, ''), object: p.object, kind: p.kind, need: p.need, pose, size: sizeOf(pose), ts, vis, visPts, visFrac: n ? vis.length / n : 1, parentId: p.attachedTo || null };
    });
    comps.forEach(C => { C.graded = C.kind === 'dot' || C.visFrac >= 0.1; });
    const objects = d.groups.map((g, oi) => {
      const cs = comps.filter(C => g.parts.includes(C.id)), area = C => (C.kind === 'line' || C.kind === 'arc' || C.kind === 'dot' ? 0 : C.pose.w * C.pose.h);
      const rootC = cs.slice().sort((a, b) => area(b) - area(a) || a.k - b.k)[0];
      const samples = []; cs.forEach(C => { if (C.graded && C.kind !== 'dot') C.visPts.forEach(p => samples.push(p)); });
      return { oi, id: g.id, name: g.name, kind: g.kind, comps: cs, root: rootC, centre: [(g.bounds[0] + g.bounds[2]) / 2, (g.bounds[1] + g.bounds[3]) / 2], samples: thin(samples, 180), area: (g.bounds[2] - g.bounds[0]) * (g.bounds[3] - g.bounds[1]) };
    });
    const byId = Object.fromEntries(comps.map(C => [C.id, C]));
    objects.forEach(O => O.comps.forEach(C => {
      C.oi = O.oi;
      C.parent = C === O.root ? null : (C.parentId && byId[C.parentId] && byId[C.parentId].oi === undefined ? null : byId[C.parentId]) || O.root;
      C.weight = C.graded ? IMPORTANCE[C.need] * Math.min(1, Math.max(0.5, Math.sqrt(C.size / Math.max(0.01, O.root.size)))) * (OBJECT_WEIGHT[O.kind] || 0.5) : 0;
    }));
    objects.forEach(O => O.comps.forEach(C => { if (C.parent && C.parent.oi !== C.oi) C.parent = O.root; }));
    // order: characters, then things touching something already placed, then the rest, biggest first
    const placed = [], rest = objects.slice().sort((a, b) => (a.kind === 'character' ? 0 : 1) - (b.kind === 'character' ? 0 : 1) || b.area - a.area);
    const rel = d.relations || [];
    while (rest.length) {
      let i = rest.findIndex(O => O.kind === 'character');
      if (i < 0) i = rest.findIndex(O => rel.some(r => r.contact && ((r.a === O.id && placed.some(P => P.id === r.b)) || (r.b === O.id && placed.some(P => P.id === r.a)))));
      if (i < 0) i = 0;
      placed.push(rest.splice(i, 1)[0]);
    }
    return { comps, objects, order: placed.map(O => O.oi), relations: rel };
  }

  // ---------- the ink
  function inkOf(strokes) {
    const list = [];
    for (const raw of strokes || []) {
      const s = [];
      for (const p of raw || []) { const x = +p[0], y = +p[1]; if (isFinite(x) && isFinite(y) && (!s.length || x !== s[s.length - 1][0] || y !== s[s.length - 1][1])) s.push([x, y]); }
      if (!s.length) continue;
      const A = s[0], Z = s[s.length - 1];
      if (s.length > 2 && Math.hypot(A[0] - Z[0], A[1] - Z[1]) < 1e-6) {
        // a closed loop: start at its first point in (x, y) order and run counter-clockwise on screen
        s.pop(); let m = 0; for (let i = 1; i < s.length; i++) if (s[i][0] < s[m][0] || (s[i][0] === s[m][0] && s[i][1] < s[m][1])) m = i;
        const r = s.slice(m).concat(s.slice(0, m)); let area = 0; for (let i = 0; i < r.length; i++) { const [x0, y0] = r[i], [x1, y1] = r[(i + 1) % r.length]; area += x0 * y1 - x1 * y0; }
        if (area > 0) { const h = r.shift(); r.reverse(); r.unshift(h); }
        r.push(r[0]); list.push(r);
      } else {
        if (Z[0] < A[0] || (Z[0] === A[0] && Z[1] < A[1])) s.reverse();
        list.push(s);
      }
    }
    list.sort((p, q) => p[0][0] - q[0][0] || p[0][1] - q[0][1] || p.length - q.length || p[p.length - 1][0] - q[q.length - 1][0] || p[p.length - 1][1] - q[q.length - 1][1]);
    const pts = [], taps = [], strokes2 = [];
    list.forEach((s, sid) => {
      let L = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < s.length; i++) { if (i) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); x0 = Math.min(x0, s[i][0]); x1 = Math.max(x1, s[i][0]); y0 = Math.min(y0, s[i][1]); y1 = Math.max(y1, s[i][1]); }
      const diag = Math.hypot(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (L < RULES.tap) { taps.push({ sid, x: cx, y: cy, diam: diag, len: L }); strokes2.push({ sid, raw: s, len: L, diag, cx, cy, idx: [], tap: true }); return; }
      const R = resample(s, RULES.inkStep), idx = [];
      for (let i = 0; i < R.length; i++) {
        const A = R[Math.max(0, i - 2)], B = R[Math.min(R.length - 1, i + 2)];
        idx.push(pts.length);
        pts.push({ x: R[i][0], y: R[i][1], ang: deg(Math.atan2(B[1] - A[1], B[0] - A[0])), sid });
      }
      strokes2.push({ sid, raw: s, len: L, diag, cx, cy, idx, tap: false });
    });
    return { pts, taps, strokes: strokes2, length: pts.length * RULES.inkStep + taps.reduce((a, t) => a + t.len, 0) };
  }
  function resample(s, step) {
    const out = [s[0].slice()]; let carry = 0;
    for (let i = 1; i < s.length; i++) {
      const [x0, y0] = s[i - 1], [x1, y1] = s[i], L = Math.hypot(x1 - x0, y1 - y0);
      let pos = step - carry;
      while (pos <= L + 1e-12) { const f = L ? pos / L : 0; out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]); pos += step; }
      carry = L - (pos - step);
    }
    const last = s[s.length - 1], prev = out[out.length - 1];
    if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) > step * 0.3) out.push(last.slice());
    return out;
  }

  // ---------- distance fields: one per stroke direction (each ink point joins the bins within 30 degrees), and one for all
  function edt(sites) {
    const INF = 1e20, g = new Float64Array(N * N), f = new Float64Array(N), dd = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
    let any = false; for (let i = 0; i < N * N; i++) { g[i] = sites[i] ? 0 : INF; if (sites[i]) any = true; }
    const out = new Float32Array(N * N);
    if (!any) { out.fill(1000); return out; }
    const line = (get, set) => {
      for (let q = 0; q < N; q++) f[q] = get(q);
      let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
      for (let q = 1; q < N; q++) {
        let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
      }
      k = 0;
      for (let q = 0; q < N; q++) { while (z[k + 1] < q) k++; dd[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
      for (let q = 0; q < N; q++) set(q, dd[q]);
    };
    for (let x = 0; x < N; x++) line(q => g[q * N + x], (q, val) => { g[q * N + x] = val; });
    for (let y = 0; y < N; y++) line(q => g[y * N + q], (q, val) => { g[y * N + q] = val; });
    for (let i = 0; i < N * N; i++) out[i] = Math.sqrt(g[i]) * CELL;
    return out;
  }
  const binOf = ang => ((Math.round(wrap(ang, 180) / (180 / BINS)) % BINS) + BINS) % BINS;
  function fieldsOf(pts, taps) {
    const sites = []; for (let b = 0; b <= BINS; b++) sites.push(new Uint8Array(N * N));
    const put = (x, y, bins) => { const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL); if (gx < 0 || gy < 0 || gx >= N || gy >= N) return; for (const b of bins) sites[b][gy * N + gx] = 1; };
    for (const p of pts) { const bins = [BINS]; for (let b = 0; b < BINS; b++) if (Math.abs(wrap(p.ang - (180 * b) / BINS, 180)) <= 180 / BINS + 1e-9) bins.push(b); put(p.x, p.y, bins); }
    for (const t of taps) put(t.x, t.y, [BINS]);
    return sites.map(edt);
  }
  function at(F, x, y) {
    const gx = x / CELL - 0.5, gy = y / CELL - 0.5;
    const ix = Math.max(0, Math.min(N - 2, Math.floor(gx))), iy = Math.max(0, Math.min(N - 2, Math.floor(gy)));
    const fx = Math.max(0, Math.min(1, gx - ix)), fy = Math.max(0, Math.min(1, gy - iy)), i = iy * N + ix;
    const v = F[i] * (1 - fx) * (1 - fy) + F[i + 1] * fx * (1 - fy) + F[i + N] * (1 - fx) * fy + F[i + N + 1] * fx * fy;
    const ox = x < 0 ? -x : x > BOARD ? x - BOARD : 0, oy = y < 0 ? -y : y > BOARD ? y - BOARD : 0;
    return v + Math.hypot(ox, oy);
  }
  // ---------- placing objects
  function movePose(q, T, c) {
    const co = Math.cos(rad(T.rot)), si = Math.sin(rad(T.rot)), ux = q.x - c[0], uy = q.y - c[1];
    return Object.assign({}, q, { x: c[0] + T.tx + T.s * (ux * co - uy * si), y: c[1] + T.ty + T.s * (ux * si + uy * co), w: q.w * T.s, h: q.h * T.s, r: q.r + T.rot });
  }
  function alignObject(O, F, win) {
    const S = O.samples, [cx, cy] = O.centre, D = Math.min(RULES.delta, Math.max(0.3, 0.2 * Math.sqrt(O.area))) * win.s, D2 = D * D;
    const cover = (tx, ty, ls, rot) => {
      if (!S.length) return 0;
      const s = Math.exp(ls), c = Math.cos(rad(rot)), sn = Math.sin(rad(rot)); let sum = 0;
      for (const [x, y, ang] of S) {
        const ux = x - cx, uy = y - cy, X = cx + tx + s * (ux * c - uy * sn), Y = cy + ty + s * (ux * sn + uy * c);
        const dd = at(F[binOf(ang + rot)], X, Y);
        if (dd < D) sum += 1 - (dd * dd) / D2;
      }
      return sum / S.length;
    };
    const ls0 = Math.log(win.s);
    const score = (tx, ty, ls, rot) => cover(tx, ty, ls, rot) - 0.004 * ((tx - win.tx) ** 2 + (ty - win.ty) ** 2) - win.k * (ls - ls0) ** 2 - 0.0001 * (rot - win.rot) ** 2;
    let best = { v: -Infinity };
    const LS = [-0.22, -0.1, 0, 0.1, 0.22].map(v => ls0 + v), ROT = [-12, 0, 12].map(v => win.rot + v);
    const step = Math.min(1, Math.max(0.5, D * 1.4));
    for (let tx = win.tx - win.R; tx <= win.tx + win.R + 1e-9; tx += step) for (let ty = win.ty - win.R; ty <= win.ty + win.R + 1e-9; ty += step)
      for (const ls of LS) for (const rot of ROT) { const v = score(tx, ty, ls, rot); if (v > best.v) best = { v, q: [tx, ty, ls, rot] }; }
    let q = best.q, v = best.v, steps = [0.5, 0.5, 0.06, 6];
    for (let it = 0; it < 6; it++) {
      for (let sweep = 0, improved = true; improved && sweep < 6; sweep++) {
        improved = false;
        for (let j = 0; j < 4; j++) for (const sg of [1, -1]) { const t = q.slice(); t[j] += sg * steps[j]; const u = score(t[0], t[1], t[2], t[3]); if (u > v + 1e-12) { v = u; q = t; improved = true; } }
      }
      steps = steps.map(x => x / 2);
    }
    return { tx: q[0], ty: q[1], s: Math.exp(q[2]), rot: q[3], cover: cover(q[0], q[1], q[2], q[3]) };
  }
  function windowFor(O, R, T) {
    for (const r of R.relations) {
      const other = r.a === O.id ? r.b : r.b === O.id ? r.a : null, A = other && R.objects.find(P => P.id === other);
      if (!A || !T[A.oi]) continue;
      const TA = T[A.oi], p = movePose({ x: O.centre[0], y: O.centre[1], w: 1, h: 1, r: 0 }, TA, A.centre);
      return { tx: p.x - O.centre[0], ty: p.y - O.centre[1], s: TA.s, rot: TA.rot, R: r.contact ? 3 : 5, k: r.contact ? 1.5 : 0.5 };
    }
    return { tx: 0, ty: 0, s: 1, rot: 0, R: 6, k: 0.25 };
  }

  // ---------- fitting a component: maximise the soft coverage of its visible outline
  function fitPart(C, init, F, avoid) {
    const ts = thin(C.vis, 120), L0 = sizeOf(init);
    if (!ts.length) return Object.assign({}, init);
    const keys = C.kind === 'line' ? ['x', 'y', 'lw', 'r'] : ['x', 'y', 'lw', 'lh', 'r'];
    const toPose = p => Object.assign({}, init, { x: p.x, y: p.y, w: Math.exp(p.lw), h: C.kind === 'line' ? 0 : Math.exp(p.lh), r: p.r });
    const score = p => {
      const q = toPose(p), tau = tauOf(sizeOf(q)), D2 = 4 * tau * tau, pts = samplesAt(q, ts); let sum = 0;
      for (const [x, y, ang] of pts) {
        if (avoid && avoid.some(A => closest(A, x, y)[0] < tauOf(sizeOf(A)))) continue;
        const dd = at(F[binOf(ang)], x, y);
        if (dd * dd < D2) sum += 1 - (dd * dd) / D2;
      }
      const dc = Math.hypot(q.x - init.x, q.y - init.y) / Math.max(1, L0);
      const dz = Math.abs(Math.log(q.w / init.w)) + (C.kind === 'line' ? 0 : Math.abs(Math.log(q.h / init.h)));
      return sum / pts.length - 0.02 * (dc + dz + Math.abs(wrap(q.r - init.r, 360)) / 90);
    };
    const climb = r0 => {
      let p = { x: init.x, y: init.y, lw: Math.log(Math.max(1e-3, init.w)), lh: Math.log(Math.max(1e-3, init.h)), r: r0 }, v = score(p);
      const st = { x: Math.max(0.1, 0.15 * L0), y: Math.max(0.1, 0.15 * L0), lw: 0.1, lh: 0.1, r: 8 };
      for (let it = 0; it < 6; it++) {
        for (let sweep = 0, improved = true; improved && sweep < 6; sweep++) {
          improved = false;
          for (const k of keys) for (const sg of [1, -1]) { const t = Object.assign({}, p); t[k] += sg * st[k]; const u = score(t); if (u > v + 1e-12) { v = u; p = t; improved = true; } }
        }
        for (const k of keys) st[k] /= 2;
      }
      return { p, v };
    };
    let best = climb(init.r);
    // a part drawn turned or upside down: start again from its other turns; the turns are compared by a strict coverage
    // (within half of tau), and another turn is kept only if it covers clearly more
    const turns = ['tri', 'semi'].includes(C.kind) || (C.kind === 'arc' && Math.abs(C.pose.a1 - C.pose.a0) < 300) ? [90, 180, 270] : C.kind === 'line' || (aspect(C.pose) > 1.15 && C.kind !== 'arc') ? [90] : [];
    if (best.v < 0.97 && turns.length) {
      const strict = p => {
        const q = toPose(p), h = 0.5 * tauOf(sizeOf(q)), H2 = h * h, pts = samplesAt(q, ts); let sum = 0;
        for (const [x, y, ang] of pts) { if (avoid && avoid.some(A => closest(A, x, y)[0] < tauOf(sizeOf(A)))) continue; const dd = at(F[binOf(ang)], x, y); if (dd * dd < H2) sum += 1 - (dd * dd) / H2; }
        return sum / pts.length;
      };
      let bs = strict(best.p);
      for (const dr of turns) { const b = climb(init.r + dr), sb = strict(b.p); if (sb > bs + 0.05) { best = b; bs = sb; } }
    }
    return toPose(best.p);
  }

  // ---------- refining a component on its own ink: mean distance from that ink to the outline plus mean distance
  // from the visible outline to that ink, both capped at tau, minimised over centre, width, height and turn
  function refinePart(C, q0, own, tau) {
    if (own.length < 4 || !C.vis.length) return q0;
    const ownT = thin(own, 120), ts = thin(C.vis, 80), keys = C.kind === 'line' ? ['x', 'y', 'lw', 'r'] : ['x', 'y', 'lw', 'lh', 'r'], L = sizeOf(q0);
    const near = localField(own, boxOf(q0, 2 * tau + 1));
    const toPose = p => Object.assign({}, q0, { x: p.x, y: p.y, w: Math.exp(p.lw), h: C.kind === 'line' ? 0 : Math.exp(p.lh), r: p.r });
    // what the visible ink can't show (the hidden end of a handlebar) stays where the first fit put it
    const J = p => {
      const q = toPose(p); let dev = 0, gap = 0;
      for (const [x, y] of ownT) dev += Math.min(tau, closest(q, x, y)[0]);
      for (const [x, y] of samplesAt(q, ts)) gap += Math.min(tau, near(x, y));
      const prior = Math.hypot(q.x - q0.x, q.y - q0.y) / Math.max(1, L) + Math.abs(Math.log(q.w / q0.w)) + (C.kind === 'line' ? 0 : Math.abs(Math.log(q.h / q0.h))) + Math.abs(wrap(q.r - q0.r, 360)) / 90;
      return (dev / ownT.length + gap / ts.length) / tau + 0.05 * prior;
    };
    const descend = r0 => {
      let p = { x: q0.x, y: q0.y, lw: Math.log(Math.max(1e-3, q0.w)), lh: Math.log(Math.max(1e-3, q0.h)), r: r0 }, v = J(p);
      const st = { x: 0.06 * L + 0.02, y: 0.06 * L + 0.02, lw: 0.06, lh: 0.06, r: 5 };
      for (let it = 0; it < 6; it++) {
        for (let sweep = 0, improved = true; improved && sweep < 6; sweep++) {
          improved = false;
          for (const k of keys) for (const sg of [1, -1]) { const t = Object.assign({}, p); t[k] += sg * st[k]; const u = J(t); if (u < v - 1e-12) { v = u; p = t; improved = true; } }
        }
        for (const k of keys) st[k] /= 2;
      }
      return { p, v };
    };
    let best = descend(q0.r);
    // a part drawn turned or upside down: start again from the other turns, keep one only if it fits clearly better
    if (best.v > 0.02) {
      const turns = ['tri', 'semi', 'arc'].includes(C.kind) ? [90, 180, 270] : C.kind === 'line' || aspect(q0) > 1.15 ? [90] : [];
      for (const dr of turns) { const b = descend(q0.r + dr); if (b.v < best.v - 0.02) best = b; }
    }
    return toPose(best.p);
  }

  // ---------- one-to-one assignment (Hungarian method, minimising a square cost matrix)
  function hungarian(cost) {
    const n = cost.length, INF = 1e18, u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0), p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i; let j0 = 0; const minv = new Array(n + 1).fill(INF), used = new Array(n + 1).fill(false);
      do {
        used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
        for (let j = 1; j <= n; j++) if (!used[j]) { const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < delta) { delta = minv[j]; j1 = j; } }
        for (let j = 0; j <= n; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const res = new Array(n).fill(-1); for (let j = 1; j <= n; j++) if (p[j]) res[p[j] - 1] = j - 1; return res;
  }

  // ---------- shape: compare the ink with the reference outline after translation, turn and uniform scale
  // distance to a set of points on a small local grid (0.05 units), for many lookups
  function localField(pts, box) {
    const c = 0.05, x0 = box[0], y0 = box[1], W = Math.max(2, Math.ceil((box[2] - box[0]) / c) + 1), H = Math.max(2, Math.ceil((box[3] - box[1]) / c) + 1);
    const g = new Float64Array(W * H).fill(1e20), out = new Float32Array(W * H);
    for (const [x, y] of pts) { const i = Math.round((x - x0) / c), j = Math.round((y - y0) / c); if (i >= 0 && j >= 0 && i < W && j < H) g[j * W + i] = 0; }
    const f = new Float64Array(Math.max(W, H)), dd = new Float64Array(Math.max(W, H)), v = new Int32Array(Math.max(W, H)), z = new Float64Array(Math.max(W, H) + 1);
    const pass = (n, get, set) => {
      for (let q = 0; q < n; q++) f[q] = get(q);
      let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
      for (let q = 1; q < n; q++) { let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); } k++; v[k] = q; z[k] = s; z[k + 1] = Infinity; }
      k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; dd[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
      for (let q = 0; q < n; q++) set(q, dd[q]);
    };
    if (pts.length) {
      for (let i = 0; i < W; i++) pass(H, q => g[q * W + i], (q, val) => { g[q * W + i] = val; });
      for (let j = 0; j < H; j++) pass(W, q => g[j * W + q], (q, val) => { g[j * W + q] = val; });
    }
    for (let i = 0; i < W * H; i++) out[i] = pts.length ? Math.sqrt(g[i]) * c : 1e3;
    return (x, y) => { const i = Math.round((x - x0) / c), j = Math.round((y - y0) / c); if (i < 0 || j < 0 || i >= W || j >= H) return 1e3; return out[j * W + i]; };
  }
  function contourError(C, ref, own, near, x, y, ls, r, asLine) {
    const s = Math.exp(ls);
    let q;
    if (asLine) { const long = ref.w >= ref.h; q = { kind: 'line', x, y, w: (long ? ref.w : ref.h) * s, h: 0, r: r + (long ? 0 : 90) }; }
    else q = Object.assign({}, ref, { x, y, w: ref.w * s, h: ref.h * s, r });
    const L = sizeOf(ref) * s, tau = tauOf(L);
    let dev = 0; for (const [px, py] of own) dev += closest(q, px, py)[0];
    dev /= Math.max(1, own.length);
    const ts = asLine ? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] : thin(C.vis, 80);
    let gap = 0; for (const [sx, sy] of samplesAt(q, ts)) gap += Math.min(2 * tau, near(sx, sy));
    gap /= Math.max(1, ts.length);
    return (dev + gap) / 2 / L;
  }
  function shapeOf(C, fit, ownAll) {
    const ref = C.pose, own = thin(ownAll, 150), pad = 3 * tauOf(sizeOf(fit)) + 0.5, bx = boxOf(fit, pad), hash = localField(ownAll, bx);
    const s0 = C.kind === 'line' ? fit.w / Math.max(1e-6, ref.w) : Math.sqrt((fit.w * Math.max(fit.h, 1e-3)) / Math.max(1e-6, ref.w * Math.max(ref.h, 1e-3)));
    const run = (asLine, r0) => {
      let p = [fit.x, fit.y, Math.log(Math.max(1e-3, s0)), r0], v = contourError(C, ref, own, hash, ...p, asLine), st = [0.1 * sizeOf(fit), 0.1 * sizeOf(fit), 0.08, 6];
      for (let it = 0; it < 5; it++) {
        for (let sweep = 0, improved = true; improved && sweep < 5; sweep++) {
          improved = false;
          for (let j = 0; j < 4; j++) for (const sg of [1, -1]) { const t = p.slice(); t[j] += sg * st[j]; const u = contourError(C, ref, own, hash, ...t, asLine); if (u < v - 1e-12) { v = u; p = t; improved = true; } }
        }
        st = st.map(x => x / 2);
      }
      return v;
    };
    let starts = [fit.r];
    if (C.kind === 'ellipse' || C.kind === 'rect') starts = [fit.r, fit.r + 90];
    if (C.kind === 'tri' && equilateral(ref)) starts = [fit.r, fit.r + 120, fit.r + 240];
    let E = Infinity; for (const r0 of starts) E = Math.min(E, run(false, r0));
    let asLine = false;
    if (isBar(ref)) { const long = fit.w >= fit.h ? fit.r : fit.r + 90, El = run(true, long - (ref.w >= ref.h ? 0 : 90)); if (El < E) { E = El; asLine = true; } }
    return { E, asLine };
  }
  // how much better another primitive kind explains the same ink (mean ink-to-outline distance, free fit)
  function kindFit(kind, start, own) {
    const keys = kind === 'line' ? ['x', 'y', 'lw', 'r'] : ['x', 'y', 'lw', 'lh', 'r'];
    const L0 = sizeOf(start);
    const toPose = p => ({ kind, x: p.x, y: p.y, w: Math.exp(p.lw), h: kind === 'line' ? 0 : Math.exp(p.lh), r: p.r });
    const dev = p => { const q = toPose(p); let s = 0; for (const [x, y] of own) s += closest(q, x, y)[0]; const z = Math.log(sizeOf(q) / L0); return s / Math.max(1, own.length) + (Math.abs(z) > 0.7 ? (Math.abs(z) - 0.7) * L0 : 0); };
    let best = Infinity;
    for (const r0 of kind === 'tri' || kind === 'semi' ? [start.r, start.r + 180] : [start.r]) {
      let p = { x: start.x, y: start.y, lw: Math.log(Math.max(0.05, start.w)), lh: Math.log(Math.max(0.05, start.h || start.w * 0.5)), r: r0 }, v = dev(p);
      const st = { x: 0.1 * L0, y: 0.1 * L0, lw: 0.1, lh: 0.1, r: 8 };
      for (let it = 0; it < 5; it++) {
        for (let sweep = 0, improved = true; improved && sweep < 5; sweep++) {
          improved = false;
          for (const k of keys) for (const sg of [1, -1]) { const t = Object.assign({}, p); t[k] += sg * st[k]; const u = dev(t); if (u < v - 1e-12) { v = u; p = t; improved = true; } }
        }
        for (const k of keys) st[k] /= 2;
      }
      best = Math.min(best, v);
    }
    return best;
  }
  function kappaOf(C, fit, ownAll) {
    if (!['ellipse', 'rect', 'tri', 'semi'].includes(C.kind)) return { kappa: 1, ratio: 1, best: C.kind };
    const own = thin(ownAll, 90), L = sizeOf(fit), floor = 0.01 * L;
    const mine = kindFit(C.kind, fit, own);
    let best = { kind: C.kind, dev: mine };
    for (const k of ['ellipse', 'rect', 'tri', 'semi']) { if (k === C.kind) continue; const dv = kindFit(k, Object.assign({}, fit, { kind: k }), own); if (dv < best.dev) best = { kind: k, dev: dv }; }
    const ratio = (mine + floor) / (best.dev + floor);
    return { kappa: ramp(ratio, RULES.kind[0], RULES.kind[1]), ratio, best: best.kind };
  }

  // ---------- size, position and turn, measured on what is visible
  // Extents: the reference's visible outline and the player's own ink, each in the component's own frame (its turn),
  // from the 2nd to the 98th percentile for ink. rho = (smaller + 0.3) / (larger + 0.3) per axis, so a slip of a
  // tenth of a unit on a thin part doesn't count.
  const dimCredit = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b), k = RULES.slack; return ramp((lo + k) / (hi + k), RULES.size[0], RULES.size[1]); };
  function readFit(C, fit) {
    // an oval or rectangle is read with its long axis where the reference has its long axis: (w, h, r) or (h, w, r + 90)
    if (C.kind === 'ellipse' || C.kind === 'rect') {
      if (aspect(C.pose) < 1.12) return { w: fit.w, h: fit.h, r: C.pose.r };   // round: its turn means nothing, keep the reference's
      if ((fit.w >= fit.h) !== (C.pose.w >= C.pose.h)) return { w: fit.h, h: fit.w, r: fit.r + 90 };
    }
    return { w: fit.w, h: fit.h, r: fit.r };
  }
  function extentOf(pts, cx, cy, r, robust) {
    if (!pts.length) return null;
    const c = Math.cos(rad(-r)), s = Math.sin(rad(-r)), xs = [], ys = [];
    for (const p of pts) { const dx = p[0] - cx, dy = p[1] - cy; xs.push(dx * c - dy * s); ys.push(dx * s + dy * c); }
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const q = (arr, f) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(f * (arr.length - 1))))];
    const lo = robust ? 0.02 : 0, hi = robust ? 0.98 : 1, x0 = q(xs, lo), x1 = q(xs, hi), y0 = q(ys, lo), y1 = q(ys, hi), mx = (x0 + x1) / 2, my = (y0 + y1) / 2, c2 = Math.cos(rad(r)), s2 = Math.sin(rad(r));
    return { w: x1 - x0, h: y1 - y0, x: cx + mx * c2 - my * s2, y: cy + mx * s2 + my * c2 };
  }
  function sizeCredit(C, refExt, drawnExt, asLine) {
    if (!refExt || !drawnExt) return { credit: 0, dims: null, ref: null };
    if (C.kind === 'line' || asLine) { const a = asLine && refExt.h > refExt.w ? refExt.h : refExt.w, b = asLine ? Math.max(drawnExt.w, drawnExt.h) : drawnExt.w; return { credit: dimCredit(b, a), dims: [b], ref: [a] }; }
    if ((C.kind === 'ellipse' || C.kind === 'rect') && aspect(C.pose) < 1.12) {
      const a = [drawnExt.w, drawnExt.h].sort((x, y) => x - y), b = [refExt.w, refExt.h].sort((x, y) => x - y);
      return { credit: dimCredit(a[0], b[0]) * dimCredit(a[1], b[1]), dims: [drawnExt.w, drawnExt.h], ref: [refExt.w, refExt.h] };
    }
    return { credit: dimCredit(drawnExt.w, refExt.w) * dimCredit(drawnExt.h, refExt.h), dims: [drawnExt.w, drawnExt.h], ref: [refExt.w, refExt.h] };
  }
  // turn: free within 5 degrees or the turn that moves the part's end by 0.2 units, whichever is larger; none 40 degrees later
  function turnCredit(C, fit, asLine) {
    const ref = C.pose;
    let period = 360;
    if (C.kind === 'dot') return { credit: 1, err: null };
    if (C.kind === 'ellipse') { if (aspect(ref) < 1.12) return { credit: 1, err: null }; period = 180; }
    if (C.kind === 'rect') period = aspect(ref) < 1.12 ? 90 : 180;
    if (C.kind === 'line' || asLine) period = 180;
    if (C.kind === 'tri' && equilateral(ref)) period = 120;
    if (C.kind === 'arc' && Math.abs(ref.a1 - ref.a0) >= 300) return { credit: 1, err: null };
    const fr = C.kind === 'ellipse' || C.kind === 'rect' ? readFit(C, fit).r : fit.r;
    let rr = ref.r;
    if (asLine && ref.h > ref.w) rr += 90;
    const err = Math.abs(wrap(fr - rr, period)), half = Math.max(ref.w, ref.h) / 2, free = Math.max(RULES.turn[0], deg(Math.atan2(RULES.endSlip, Math.max(0.01, half))));
    return { credit: ramp(err, free, free + RULES.turn[1] - RULES.turn[0]), err, free };
  }

  // ---------- ownership: each bit of ink belongs to the visible outline it runs along (nearest sample within tau, its
  // direction within 50 degrees); ink along a hidden part of an outline is explained but doesn't count as cover
  function ownership(I, comps, fits, taus) {
    const VS = comps.map((C, k) => (fits[k] && C.kind !== 'dot' ? samplesAt(fits[k], C.vis) : []));
    const HC = 1, VH = new Map();
    VS.forEach((arr, k) => arr.forEach((p, j) => { const key = (Math.floor(p[0] / HC) + 64) * 4096 + Math.floor(p[1] / HC) + 64; let b = VH.get(key); if (!b) VH.set(key, (b = [])); b.push(k, j); }));
    const owner = new Int32Array(I.pts.length).fill(-1), hiddenOwner = new Int32Array(I.pts.length).fill(-1), lists = comps.map(() => []);
    const dk = new Float64Array(comps.length).fill(Infinity), touched = [];
    I.pts.forEach((p, i) => {
      const gx = Math.floor(p.x / HC), gy = Math.floor(p.y / HC); let bd = Infinity;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const list = VH.get((gx + a + 64) * 4096 + gy + b + 64); if (!list) continue;
        for (let m = 0; m < list.length; m += 2) {
          const k = list[m], sp = VS[k][list[m + 1]], dd = Math.hypot(sp[0] - p.x, sp[1] - p.y);
          if (dd > taus[k] + 0.05 || dd >= dk[k]) continue;
          if (dd > RULES.near && Math.abs(wrap(p.ang - sp[2], 180)) > RULES.align) continue;
          if (dk[k] === Infinity) touched.push(k);
          dk[k] = dd; if (dd < bd) { bd = dd; owner[i] = k; }
        }
      }
      // outlines that run together (a brim on a head) share the ink between them
      for (const k of touched) { if (dk[k] <= bd + RULES.share) lists[k].push(i); dk[k] = Infinity; }
      touched.length = 0;
    });
    const boxes = fits.map((q, k) => (q && comps[k].kind !== 'dot' ? boxOf(q, taus[k]) : null));
    I.pts.forEach((p, i) => {
      if (owner[i] >= 0) return;
      let bd = Infinity;
      for (let k = 0; k < fits.length; k++) {
        const b = boxes[k]; if (!b || p.x < b[0] || p.x > b[2] || p.y < b[1] || p.y > b[3]) continue;
        const [dd, ang] = closest(fits[k], p.x, p.y);
        if (dd > taus[k] || dd >= bd) continue;
        if (dd > RULES.near && Math.abs(wrap(p.ang - ang, 180)) > RULES.align) continue;
        bd = dd; hiddenOwner[i] = k;
      }
    });
    return { VS, owner, hiddenOwner, lists };
  }

  // ---------- coverage by continuous ink: a visible outline sample counts when it lies within tau of the component's own
  // ink and belongs to a run of such samples, followed by one stroke (or strokes that meet), at least a quarter of the
  // visible outline long (clamped to 0.5 to 1.5 units). Scribbles cross outlines; drawn outlines follow them.
  function runCoverage(C, vis, idx, I, tau) {
    const n = vis.length;
    if (!n || !idx.length) return { coverage: 0, runs: [] };
    const HC = 0.5, H = new Map(), R = Math.ceil(tau / HC);
    for (const i of idx) { const p = I.pts[i], key = (Math.floor(p.x / HC) + 64) * 4096 + Math.floor(p.y / HC) + 64; let b = H.get(key); if (!b) H.set(key, (b = [])); b.push(i); }
    const hit = vis.map(([x, y]) => {
      let best = -1, bd = tau; const gx = Math.floor(x / HC), gy = Math.floor(y / HC);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) { const list = H.get((gx + a + 64) * 4096 + gy + b + 64); if (!list) continue; for (const i of list) { const dd = Math.hypot(I.pts[i].x - x, I.pts[i].y - y); if (dd <= bd) { bd = dd; best = i; } } }
      return best;
    });
    const step = 1 / Math.max(1, C.ts.length), closed = !(C.kind === 'line' || C.kind === 'arc');
    const adjacent = j => { const j2 = (j + 1) % n; if (j2 === 0 && !closed) return false; const dt = j2 === 0 ? C.vis[0] + 1 - C.vis[j] : C.vis[j2] - C.vis[j]; return dt <= 1.6 * step; };
    const linked = j => {
      const j2 = (j + 1) % n, a = hit[j], b = hit[j2];
      if (a < 0 || b < 0 || !adjacent(j)) return false;
      const pa = I.pts[a], pb = I.pts[b], gap = Math.hypot(vis[j2][0] - vis[j][0], vis[j2][1] - vis[j][1]);
      return (pa.sid === pb.sid && Math.abs(a - b) * RULES.inkStep <= 3 * gap + 0.2) || Math.hypot(pa.x - pb.x, pa.y - pb.y) <= RULES.join;
    };
    // runs of linked samples (a fully visible closed outline wraps around)
    const runs = []; let cur = null;
    for (let j = 0; j < n; j++) {
      if (hit[j] < 0) { cur = null; continue; }
      if (!cur) { cur = { from: j, to: j, len: 0 }; runs.push(cur); }
      if (j < n - 1 && linked(j)) { cur.len += Math.hypot(vis[j + 1][0] - vis[j][0], vis[j + 1][1] - vis[j][1]); cur.to = j + 1; }
      else cur = null;
    }
    if (runs.length > 1 && runs[0].from === 0 && runs[runs.length - 1].to === n - 1 && linked(n - 1)) { const last = runs.pop(); runs[0] = { from: last.from, to: runs[0].to, len: runs[0].len + last.len + Math.hypot(vis[0][0] - vis[n - 1][0], vis[0][1] - vis[n - 1][1]), wraps: true }; }
    // the visible outline's own pieces (between hidden stretches) and their lengths
    const pieceOf = new Int32Array(n), pieceLen = []; let pc = 0, total = 0;
    for (let j = 0; j < n; j++) { pieceOf[j] = pc; if (pieceLen[pc] === undefined) pieceLen[pc] = 0; if (j < n - 1) { if (adjacent(j)) { const dl = Math.hypot(vis[j + 1][0] - vis[j][0], vis[j + 1][1] - vis[j][1]); pieceLen[pc] += dl; total += dl; } else pc++; } }
    if (n > 1 && adjacent(n - 1) && pieceOf[n - 1] !== pieceOf[0]) { const a = pieceOf[n - 1], b = pieceOf[0]; pieceLen[b] += pieceLen[a] + Math.hypot(vis[0][0] - vis[n - 1][0], vis[0][1] - vis[n - 1][1]); for (let j = 0; j < n; j++) if (pieceOf[j] === a) pieceOf[j] = b; }
    const minRun = Math.min(RULES.run[2], Math.max(RULES.run[1], RULES.run[0] * total));
    // a run counts when it is long enough, or covers most of a short visible piece
    let covered = 0; const good = [];
    for (const r of runs) { const need = Math.min(minRun, 0.8 * pieceLen[pieceOf[r.from]]); if (r.len >= need - 1e-9) { covered += r.wraps ? n - r.from + r.to + 1 : r.to - r.from + 1; good.push([r.from, r.to]); } }
    return { coverage: Math.min(1, covered / n), runs: good };
  }

  // ---------- the grade
  function grade(d, strokes) {
    const R = referenceOf(d), I = inkOf(strokes), comps = R.comps, fits = new Array(comps.length).fill(null), T = [];
    const taken = new Uint8Array(I.pts.length);
    let F = fieldsOf(I.pts, I.taps);
    // 1-2. objects first, then their components
    R.order.forEach((oi, n) => {
      const O = R.objects[oi], win = windowFor(O, R, T);
      if (n > 0) {
        // ink reserved by earlier objects stays visible to this one where it runs along this object's predicted outline
        const pred = comps.map(C => (C.oi === oi && C.graded && C.kind !== 'dot' ? movePose(C.pose, win, O.centre) : null));
        const keep = ownership(I, comps, pred, comps.map((C, k) => (pred[k] ? 0.2 : 0))).owner;
        F = fieldsOf(I.pts.filter((p, i) => !taken[i] || keep[i] >= 0), I.taps);
      }
      const t = alignObject(O, F, win);
      T[oi] = Object.assign(t, { found: t.cover >= RULES.objectFound });
      const cs = O.comps.filter(C => C.graded && C.kind !== 'dot').sort((a, b) => b.weight - a.weight || a.k - b.k);
      for (const C of cs) fits[C.k] = fitPart(C, movePose(C.pose, t, O.centre), F, null);
      // look-alike siblings: one to one by where the object says each should be
      const sib = {};
      cs.forEach(C => { const key = C.kind + '|' + C.stem; (sib[key] = sib[key] || []).push(C); });
      for (const G of Object.values(sib)) {
        if (G.length < 2) continue;
        const pred = G.map(C => movePose(C.pose, t, O.centre)), cand = G.map(C => fits[C.k]);
        const cost = G.map((C, i) => cand.map(q => Math.hypot(q.x - pred[i].x, q.y - pred[i].y) / Math.max(1, sizeOf(pred[i])) + Math.abs(Math.log(sizeOf(q) / sizeOf(pred[i])))));
        const asg = hungarian(cost);
        G.forEach((C, i) => { fits[C.k] = cand[asg[i]]; });
        // two siblings on the same ink: the one it suits less looks again, away from the other
        for (let i = 0; i < G.length; i++) for (let j = 0; j < G.length; j++) {
          if (i === j) continue;
          const a = fits[G[i].k], b = fits[G[j].k];
          if (Math.hypot(a.x - b.x, a.y - b.y) < 0.25 * Math.max(sizeOf(a), sizeOf(b)) && cost[i][asg[i]] > cost[j][asg[j]]) fits[G[i].k] = fitPart(G[i], pred[i], F, [b]);
        }
      }
      // the ink along this object's visible outlines is reserved; objects placed later look at the rest
      if (n < R.order.length - 1) {
        const own = ownership(I, comps, comps.map((C, k) => (C.oi === oi ? fits[k] : null)), comps.map((C, k) => (C.oi === oi && fits[k] ? 0.5 * tauOf(sizeOf(fits[k])) : 0)));
        own.owner.forEach((k, i) => { if (k >= 0) taken[i] = 1; });
      }
    });
    // 3. share the ink out, refine each component on its own ink with exact distances, and share it out again
    let taus = comps.map((C, k) => (fits[k] ? tauOf(sizeOf(fits[k])) : 0));
    const first = ownership(I, comps, fits, taus);
    comps.forEach((C, k) => {
      if (!fits[k] || C.kind === 'dot') return;
      const pts = first.lists[k].map(i => [I.pts[i].x, I.pts[i].y]); I.pts.forEach((p, i) => { if (first.hiddenOwner[i] === k) pts.push([p.x, p.y]); });
      fits[k] = refinePart(C, fits[k], pts, taus[k]);
    });
    taus = comps.map((C, k) => (fits[k] ? tauOf(sizeOf(fits[k])) : 0));
    const { VS, owner, hiddenOwner, lists } = ownership(I, comps, fits, taus);
    // 4. dots: taps, small closed loops, and small strokes that no outline claims, matched one to one with the dots
    //    near where their parent puts them
    const dots = comps.filter(C => C.kind === 'dot' && C.graded), dotMatch = {};
    const dotMax = Math.max(RULES.dotMax, 2.5 * Math.max(0, ...dots.map(C => C.pose.w)));
    // small strokes that touch are one mark (a dot drawn in pieces); a mark is a dot candidate when it is a tap, turns
    // through 200 degrees or more (a little circle or scribble), or is mostly ink no outline owns
    const turnOf = st => { let t = 0; for (let m = 1; m < st.idx.length; m++) t += Math.abs(wrap(I.pts[st.idx[m]].ang - I.pts[st.idx[m - 1]].ang, 360)); return t; };
    // a stroke can be part of a dot when it loops, curls tightly (120 degrees a unit or more: a piece of a tiny circle) or is ink no outline owns
    const small = I.strokes.filter(st => { if (st.tap || st.diag > dotMax) return false; const tn = turnOf(st); return tn >= 200 || tn / Math.max(0.1, st.len) >= 120 || st.idx.filter(i => owner[i] >= 0).length < 0.5 * st.idx.length; }), parent = small.map((_, i) => i);
    const findRoot = i => (parent[i] === i ? i : (parent[i] = findRoot(parent[i])));
    for (let a = 0; a < small.length; a++) for (let b = a + 1; b < small.length; b++) {
      let near = false;
      for (const i of small[a].idx) { for (const j of small[b].idx) if (Math.hypot(I.pts[i].x - I.pts[j].x, I.pts[i].y - I.pts[j].y) <= 0.3) { near = true; break; } if (near) break; }
      if (near) parent[findRoot(a)] = findRoot(b);
    }
    const clusters = new Map(); small.forEach((st, i) => { const r = findRoot(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(st); });
    const cands = [];
    I.strokes.forEach(st => { if (st.tap) cands.push({ x: st.cx, y: st.cy, diam: 0, sid: st.sid, sids: [st.sid], idx: [], tap: true }); });
    for (const group of clusters.values()) {
      const idx = [].concat(...group.map(st => st.idx));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, turn = 0;
      for (const i of idx) { const p = I.pts[i]; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
      for (const st of group) for (let m = 1; m < st.idx.length; m++) turn += Math.abs(wrap(I.pts[st.idx[m]].ang - I.pts[st.idx[m - 1]].ang, 360));
      const diag = Math.hypot(x1 - x0, y1 - y0), owned = idx.filter(i => owner[i] >= 0).length;
      if (diag > dotMax) continue;
      if (turn >= 200 || owned < 0.5 * idx.length) cands.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, diam: diag / Math.SQRT2, sid: group[0].sid, sids: group.map(st => st.sid), idx, tap: false });
    }
    const parentFound = P => P && fits[P.k] && VS[P.k].length;
    const predict = C => {
      const O = R.objects[C.oi], P = C.parent;
      if (parentFound(P)) {
        const pr = P.pose, pf = readFitPose(P, fits[P.k]), c0 = Math.cos(rad(-pr.r)), s0 = Math.sin(rad(-pr.r)), dx = C.pose.x - pr.x, dy = C.pose.y - pr.y;
        const lx = ((dx * c0 - dy * s0) / Math.max(1e-6, pr.w)) * pf.w, ly = ((dx * s0 + dy * c0) / Math.max(1e-3, pr.h)) * Math.max(pf.h, 1e-3), c1 = Math.cos(rad(pf.r)), s1 = Math.sin(rad(pf.r));
        return { x: pf.x + lx * c1 - ly * s1, y: pf.y + lx * s1 + ly * c1, reach: Math.max(0.8, RULES.dotReach * sizeOf(pf)) };
      }
      const m = movePose(C.pose, T[C.oi], O.centre);
      return { x: m.x, y: m.y, reach: Math.max(0.8, RULES.dotReach * (P ? P.size * T[C.oi].s : 2)) };
    };
    if (dots.length && cands.length) {
      const preds = dots.map(predict), n = Math.max(dots.length, cands.length), cost = [];
      for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) { if (i < dots.length && j < cands.length) { const dd = Math.hypot(cands[j].x - preds[i].x, cands[j].y - preds[i].y) / preds[i].reach; row.push(dd < 1 ? dd : 10); } else row.push(5); } cost.push(row); }
      const asg = hungarian(cost);
      dots.forEach((C, i) => { const j = asg[i]; if (j >= 0 && j < cands.length && cost[i][j] < 1) dotMatch[C.k] = { cand: cands[j], pred: preds[i] }; });
      const toDot = new Set(); for (const k of Object.keys(dotMatch)) for (const i of dotMatch[k].cand.idx) { owner[i] = Number(k); hiddenOwner[i] = -1; toDot.add(i); }
      lists.forEach((L, k) => { if (comps[k].kind !== 'dot') lists[k] = L.filter(i => !toDot.has(i)); });
    }
    // 5. evidence: coverage of each visible outline by the component's own ink, and unexplained ink crossing it
    const ownPts = comps.map((C, k) => (C.kind === 'dot' ? [] : lists[k].map(i => [I.pts[i].x, I.pts[i].y])));
    // ink a component owns outright (nearest outline): its extent gives the drawn size and position
    const soloPts = comps.map(() => []);
    I.pts.forEach((p, i) => { if (owner[i] >= 0 && comps[owner[i]].kind !== 'dot') soloPts[owner[i]].push([p.x, p.y]); });
    const solo = comps.map(() => []);
    I.pts.forEach((p, i) => { if (owner[i] >= 0 && comps[owner[i]].kind !== 'dot') solo[owner[i]].push(i); });
    const ev = comps.map((C, k) => {
      if (!fits[k] || C.kind === 'dot') return null;
      const q = fits[k], tau = taus[k], vis = VS[k], cov = runCoverage(C, vis, solo[k], I, tau), b2 = boxOf(q, 2 * tau);
      let cross = 0;
      I.pts.forEach((p, i) => { if (owner[i] >= 0 || hiddenOwner[i] >= 0 || p.x < b2[0] || p.x > b2[2] || p.y < b2[1] || p.y > b2[3]) return; if (closest(q, p.x, p.y)[0] <= 2 * tau) cross++; });
      const clutter = (cross * RULES.inkStep) / (solo[k].length * RULES.inkStep + 0.5);
      return { coverage: cov.coverage, runs: cov.runs, clutter, found: cov.coverage >= RULES.found && clutter <= RULES.clutter };
    });
    // 5b. a component is not found when its fit wandered off: its centre too far from where its object puts it (30% of
    //     the object's size for the root, 60% of the parent's size or 0.8 units for the rest), its size outside 0.45x to
    //     2.2x, or its proportions three times off. Two components on one outline (60% of the visible samples within
    //     0.12 units of the other's outline): the one that moved further from where it belongs loses it.
    const pred = comps.map(C => (C.graded && C.kind !== 'dot' ? movePose(C.pose, T[C.oi], R.objects[C.oi].centre) : null));
    const drift = comps.map((C, k) => (pred[k] && fits[k] ? Math.hypot(fits[k].x - pred[k].x, fits[k].y - pred[k].y) : Infinity));
    comps.forEach((C, k) => {
      const e = ev[k]; if (!e || !e.found) return;
      const O = R.objects[C.oi], q = fits[k], pq = pred[k], why = [];
      const reach = C.parent ? Math.max(RULES.drift[2], RULES.drift[1] * C.parent.size * T[C.oi].s) : RULES.drift[0] * Math.sqrt(O.area) * T[C.oi].s;
      if (drift[k] > reach) why.push('far from where it belongs');
      const sr = sizeOf(q) / Math.max(1e-6, sizeOf(pq)); if (sr < RULES.sizeRange[0] || sr > RULES.sizeRange[1]) why.push('wrong size');
      if (C.kind !== 'line' && C.kind !== 'dot' && !isBar(C.pose)) { const ar = aspect(q) / aspect(C.pose); if (ar > RULES.aspectRange || ar < 1 / RULES.aspectRange) why.push('wrong proportions'); }
      if (why.length) { e.found = false; e.rejected = why; }
    });
    comps.forEach((C, k) => {
      const e = ev[k]; if (!e || !e.found) return;
      for (let m = 0; m < comps.length; m++) {
        if (m === k || !ev[m] || !ev[m].found || comps[m].oi !== C.oi) continue;
        let on = 0; for (const [x, y] of VS[k]) if (closest(fits[m], x, y)[0] <= RULES.duplicate[0]) on++;
        if (VS[k].length && on / VS[k].length > RULES.duplicate[1]) {
          const dk = drift[k] / Math.max(0.5, C.size), dm = drift[m] / Math.max(0.5, comps[m].size);
          if (dk > dm) { e.found = false; e.rejected = ['on the ' + comps[m].part + "'s outline"]; break; }
        }
      }
    });

    // 6. credits
    const frameR = (C, q) => ((C.kind === 'ellipse' || C.kind === 'rect') && aspect(C.pose) < 1.12 ? C.pose.r : C.kind === 'ellipse' || C.kind === 'rect' ? readFit(C, q).r : q.r);
    const refExt = comps.map(C => (C.kind === 'dot' ? { w: C.pose.w, h: C.pose.w, x: C.pose.x, y: C.pose.y } : extentOf(C.visPts, C.pose.x, C.pose.y, C.pose.r, false)));
    const drawnExt = comps.map((C, k) => {
      if (C.kind === 'dot') { const m = dotMatch[k]; return m ? { w: m.cand.diam, h: m.cand.diam, x: m.cand.x, y: m.cand.y } : null; }
      if (!fits[k] || !ev[k] || !ev[k].found) return null;
      return extentOf(soloPts[k].length >= 3 ? soloPts[k] : ownPts[k], fits[k].x, fits[k].y, frameR(C, fits[k]), true);
    });
    const rows = comps.map((C, k) => {
      const O = R.objects[C.oi], t = T[C.oi], base = { id: C.id, part: C.part, object: C.object, objectName: O.name, kind: C.kind, need: C.need, weight: C.weight, graded: C.graded, visible: C.visFrac };
      const place = ramp(Math.hypot(t.tx, t.ty), RULES.place[0], RULES.place[1]);
      // position: half the object's placement, half the offset of the visible centre from the parent's visible centre
      const relPos = (cx, cy) => {
        if (!C.parent) return { credit: place, rel: null, err: null };
        const P = C.parent, pr = refExt[P.k], pd = drawnExt[P.k] || (pr ? movePose({ x: pr.x, y: pr.y, w: 1, h: 1, r: 0 }, t, O.centre) : null), me = refExt[k];
        if (!pr || !pd || !me) return { credit: place, rel: null, err: null };
        const co = Math.cos(rad(t.rot)), si = Math.sin(rad(t.rot)), ex = (me.x - pr.x) * t.s, ey = (me.y - pr.y) * t.s, wx = ex * co - ey * si, wy = ex * si + ey * co;
        const err = Math.hypot(cx - pd.x - wx, cy - pd.y - wy) / Math.max(0.3, P.size * t.s), rc = ramp(err, RULES.rel[0], RULES.rel[1]);
        return { credit: 0.5 * place + 0.5 * rc, rel: rc, err };
      };
      if (!C.graded) return Object.assign(base, { found: false, skipped: true, credits: null, points: 0 });
      if (C.kind === 'dot') {
        const m = dotMatch[k];
        if (!m) return Object.assign(base, { found: false, credits: { shape: 0, size: 0, position: 0, orientation: 0 }, credit: 0, pred: predict(C) });
        const q = m.cand.tap ? 1 : m.cand.diam / C.pose.w, sz = q < RULES.dot[0] ? ramp(q, RULES.dot[0], RULES.dot[2]) : ramp(q, RULES.dot[1], RULES.dot[3]);
        const pos = relPos(m.cand.x, m.cand.y), cr = { shape: 1, size: sz, position: pos.credit, orientation: 1 };
        return Object.assign(base, { found: true, credits: cr, credit: credit(cr), at: [m.cand.x, m.cand.y], diam: m.cand.diam, tap: m.cand.tap, measures: { relErr: pos.err, placeErr: Math.hypot(t.tx, t.ty), sizeRatio: q } });
      }
      const e = ev[k], q = fits[k];
      if (!q) return Object.assign(base, { found: false, credits: { shape: 0, size: 0, position: 0, orientation: 0 }, credit: 0 });
      if (!e || !e.found) return Object.assign(base, { found: false, rejected: e && e.rejected ? e.rejected : null, credits: { shape: 0, size: 0, position: 0, orientation: 0 }, credit: 0, fit: q, coverage: e ? e.coverage : 0, clutter: e ? e.clutter : 0 });
      const sh = shapeOf(C, q, ownPts[k]), kp = sh.asLine ? { kappa: 1, ratio: 1, best: 'line' } : kappaOf(C, q, ownPts[k]), de = drawnExt[k];
      if (kp.kappa < RULES.kindFound) return Object.assign(base, { found: false, wrongKind: kp.best, credits: { shape: 0, size: 0, position: 0, orientation: 0 }, credit: 0, fit: q, coverage: e.coverage, clutter: e.clutter, measures: { kappa: kp.kappa, kindRatio: kp.ratio, bestKind: kp.best } });
      const shape = kp.kappa * ramp(sh.E, RULES.shape[0], RULES.shape[1]), sz = sizeCredit(C, refExt[k], de, sh.asLine), tn = turnCredit(C, q, sh.asLine), pos = relPos(de.x, de.y);
      const cr = { shape, size: sz.credit, position: pos.credit, orientation: tn.credit };
      return Object.assign(base, { found: true, credits: cr, credit: credit(cr), fit: q, coverage: e.coverage, clutter: e.clutter, asLine: sh.asLine, measures: { E: sh.E, kappa: kp.kappa, kindRatio: kp.ratio, bestKind: kp.best, dims: sz.dims, refDims: sz.ref, turnErr: tn.err, turnFree: tn.free, relErr: pos.err, placeErr: Math.hypot(t.tx, t.ty) } });
    });
    const Wsum = rows.reduce((a, r) => a + r.weight, 0) || 1;
    const categories = RUBRIC.map(c => { const acc = rows.reduce((a, r) => a + r.weight * (r.credits ? r.credits[c.key] : 0), 0) / Wsum; return { key: c.key, name: c.name, weight: c.weight, accuracy: acc, earned: c.weight * acc }; });
    const gross = categories.reduce((a, c) => a + c.earned, 0);
    // 7. ink that no component explains
    let unexplained = 0; const extra = [];
    I.pts.forEach((p, i) => { if (owner[i] < 0 && hiddenOwner[i] < 0) { unexplained += RULES.inkStep; extra.push([p.x, p.y]); } });
    const usedTaps = new Set([].concat(...Object.values(dotMatch).map(m => m.cand.sids)));
    I.strokes.forEach(s => { if (s.tap && !usedTaps.has(s.sid)) { unexplained += Math.max(0.1, s.len); extra.push([s.cx, s.cy]); } });
    const penalty = Math.min(RULES.inkCap, Math.max(0, unexplained - RULES.inkFree) * RULES.inkRate);
    // the unexplained ink as runs along its strokes, for drawing
    const extraRuns = [];
    I.strokes.forEach(s => { let run = []; for (const i of s.idx) { if (owner[i] < 0 && hiddenOwner[i] < 0) run.push([I.pts[i].x, I.pts[i].y]); else { if (run.length > 1) extraRuns.push(run); run = []; } } if (run.length > 1) extraRuns.push(run); if (s.tap && !usedTaps.has(s.sid)) extraRuns.push([[s.cx, s.cy], [s.cx + 0.01, s.cy]]); });
    const score = Math.max(0, gross - penalty);
    // strokes and the components their ink went to (a stroke can draw several)
    const strokeParts = I.strokes.map(s => { const m = {}; s.idx.forEach(i => { if (owner[i] >= 0) m[comps[owner[i]].id] = (m[comps[owner[i]].id] || 0) + 1; }); if (s.tap) for (const [k, v] of Object.entries(dotMatch)) if (v.cand.sids.includes(s.sid)) m[comps[k].id] = 1; return { sid: s.sid, len: s.len, parts: Object.keys(m) }; });
    return {
      score: Math.round(score), exact: score, gross, penalty, unexplained, extra, extraRuns, categories, rows,
      objects: R.objects.map(O => ({ id: O.id, name: O.name, kind: O.kind, found: T[O.oi].found, cover: T[O.oi].cover, transform: { tx: T[O.oi].tx, ty: T[O.oi].ty, s: T[O.oi].s, rot: T[O.oi].rot } })),
      strokes: strokeParts, inkLength: I.length, rules: RULES,
    };
  }
  const credit = c => 0.4 * c.shape + 0.25 * c.size + 0.2 * c.position + 0.15 * c.orientation;
  function readFitPose(P, q) { const f = P.kind === 'ellipse' || P.kind === 'rect' ? readFit(P, q) : { w: q.w, h: q.h, r: q.r }; return { x: q.x, y: q.y, w: f.w, h: f.h, r: f.r }; }

  const api = { RUBRIC, RULES, IMPORTANCE, OBJECT_WEIGHT, grade, referenceOf, samplesAt, closest, poseOf, inkOf, _: { fieldsOf, alignObject, windowFor, fitPart, refinePart, ownership, movePose, sizeOf, tauOf, localField, boxOf } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AfterimageGrader = api;
})(this);
