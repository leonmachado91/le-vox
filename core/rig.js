// core/rig.js: Two-bone analytical IK walker for slice-stacked characters.
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const DEFAULTS = {
    thigh: 7, shin: 7, ankle: 1.5, hipHalf: 2.3, standHip: 13.0, kneeHint: 1,
    stride: 18, duty: 0.56, lift: 2.8, bob: 0.45, twist: 0.14, spine: 9.2,
    arms: true, shoulderHalf: 7.0, upperArm: 4.5, foreArm: 4.5, armSwing: 0.35
  };

  function solveTwoBone(A, B, L1, L2, hint) {
    const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2];
    const d = Math.min(L1 + L2 - 1e-4, Math.max(Math.abs(L1 - L2) + 1e-4, Math.hypot(dx, dy, dz)));
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const hdot = hint[0] * ux + hint[1] * uy + hint[2] * uz;
    let px = hint[0] - ux * hdot, py = hint[1] - uy * hdot, pz = hint[2] - uz * hdot;
    let pl = Math.hypot(px, py, pz);
    if (pl < 1e-5) { px = -uy; py = ux; pz = 0; pl = Math.hypot(px, py) || 1; }
    px /= pl; py /= pl; pz /= pl;
    const along = (d * d + L1 * L1 - L2 * L2) / (2 * d);
    const out = Math.sqrt(Math.max(0, L1 * L1 - along * along));
    return [A[0] + ux * along + px * out, A[1] + uy * along + py * out, A[2] + uz * along + pz * out];
  }

  function createWalker(cfg) {
    const c = Object.assign({}, DEFAULTS, cfg || {});
    return {
      c, x: 0, y: 0, h: 0, phase: 0, hipZ: c.standHip,
      feet: [{ x: 0, y: 0, z: 0, rot: 0, planted: true }, { x: 0, y: 0, z: 0, rot: 0, planted: true }]
    };
  }

  function place(w, x, y, heading) {
    w.x = x; w.y = y; w.h = heading; w.phase = 0; w.hipZ = w.c.standHip;
    const nx = -Math.sin(heading), ny = Math.cos(heading);
    for (let i = 0; i < 2; i++) {
      const s = i ? w.c.hipHalf : -w.c.hipHalf;
      w.feet[i] = { x: x + nx * s, y: y + ny * s, z: 0, rot: heading, planted: true };
    }
  }

  function step(w, nx, ny, heading, dt) {
    const c = w.c, dist = Math.hypot(nx - w.x, ny - w.y);
    w.x = nx; w.y = ny; w.h = heading;
    if (dist > 1e-4) w.phase = (w.phase + dist / c.stride) % 1;
    const fx = Math.cos(heading), fy = Math.sin(heading), rx = -fy, ry = fx;
    const moving = dist > 0.02;

    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1;
      const ph = (w.phase + i * 0.5) % 1;
      const sx = nx + rx * side * c.hipHalf, sy = ny + ry * side * c.hipHalf;
      if (!moving) {
        w.feet[i].x += (sx - w.feet[i].x) * Math.min(1, (dt || 1 / 60) * 10);
        w.feet[i].y += (sy - w.feet[i].y) * Math.min(1, (dt || 1 / 60) * 10);
        w.feet[i].z *= 0.8; w.feet[i].rot = heading; w.feet[i].planted = true;
      } else if (ph < c.duty) {
        const u = ph / c.duty;
        const off = (0.5 - u) * c.stride * 0.5;
        w.feet[i].x = sx + fx * off; w.feet[i].y = sy + fy * off;
        w.feet[i].z = 0; w.feet[i].rot = heading; w.feet[i].planted = true;
      } else {
        const u = (ph - c.duty) / (1 - c.duty);
        const off = (-0.5 + u) * c.stride * 0.5;
        w.feet[i].x = sx + fx * off; w.feet[i].y = sy + fy * off;
        w.feet[i].z = Math.sin(u * Math.PI) * c.lift;
        w.feet[i].rot = heading; w.feet[i].planted = false;
      }
    }

    const most = Math.min(
      Math.sqrt(Math.max(0.01, (c.thigh + c.shin - 0.1) ** 2 - (c.stride * 0.25) ** 2)),
      c.standHip
    );
    const want = moving ? Math.min(c.standHip, most) : c.standHip;
    w.hipZ += (want - w.hipZ) * Math.min(1, (dt || 1 / 60) * 14);
    if (w.hipZ > most) w.hipZ = most;
  }

  function pose(w) {
    const c = w.c, ph = w.phase * TAU, fwd = [Math.cos(w.h), Math.sin(w.h), 0];
    const twist = c.twist * Math.cos(ph), hipsAngle = w.h + twist, shouldersAngle = w.h - twist * 1.2;
    const pz = w.hipZ - c.bob * Math.cos(2 * ph);
    const P = {
      x: w.x, y: w.y, heading: w.h, phase: w.phase,
      pelvis: [w.x, w.y, pz], top: [w.x, w.y, pz + c.spine],
      hipsAngle, shouldersAngle, legs: [], arms: []
    };
    for (let i = 0; i < 2; i++) {
      const side = i ? 1 : -1, f = w.feet[i];
      const hip = [w.x - Math.sin(hipsAngle) * side * c.hipHalf, w.y + Math.cos(hipsAngle) * side * c.hipHalf, pz];
      const ankle = [f.x, f.y, f.z + c.ankle];
      P.legs.push({
        hip, knee: solveTwoBone(hip, ankle, c.thigh, c.shin, [fwd[0] * c.kneeHint, fwd[1] * c.kneeHint, 0]),
        ankle, sole: [f.x, f.y, f.z], rot: f.rot, planted: f.planted
      });
      if (!c.arms) continue;
      const sh = [w.x - Math.sin(shouldersAngle) * side * c.shoulderHalf, w.y + Math.cos(shouldersAngle) * side * c.shoulderHalf, pz + c.spine];
      const a = side * c.armSwing * Math.cos(ph), L = (c.upperArm + c.foreArm) * 0.93;
      const hand = [sh[0] + fwd[0] * Math.sin(a) * L, sh[1] + fwd[1] * Math.sin(a) * L, sh[2] - Math.cos(a) * L];
      P.arms.push({ shoulder: sh, elbow: solveTwoBone(sh, hand, c.upperArm, c.foreArm, [-fwd[0], -fwd[1], 0]), hand });
    }
    return P;
  }

  global.Rig = { solveTwoBone, createWalker, place, step, pose, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
