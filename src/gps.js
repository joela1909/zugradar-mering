import { dist } from './geo.js';

/**
 * Filtert GPS-Fixes wie eine Navi-App: verwirft ältere/zwischengespeicherte Positionen,
 * grobe WLAN-/Funkzellen-Positionen, solange eine gute vorliegt, und unplausible Sprünge.
 * Nach `maxRejects` verworfenen Fixes in Folge wird wieder akzeptiert (z. B. nach einem Tunnel).
 * fix: { ll: [lon, lat], t: Zeit in ms, acc: Genauigkeit in m }
 */
export function createGpsFilter({ maxAcc = 50, maxSpeed = 60, maxRejects = 5 } = {}) {
  let last = null, rejects = 0;
  return function accept(fix) {
    if (last && fix.t <= last.t) return false;
    if (last && rejects < maxRejects) {
      const dt = Math.max(0.5, (fix.t - last.t) / 1000), d = dist(last.ll, fix.ll);
      const coarse = fix.acc > maxAcc && fix.acc > 2 * last.acc && dt < 30;
      const jump = d / dt > maxSpeed && d > fix.acc + last.acc;
      if (coarse || jump) { rejects++; return false; }
    }
    rejects = 0; last = fix; return true;
  };
}
