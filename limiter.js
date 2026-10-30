// Gleitendes Zeitfenster: höchstens `limit` Freigaben in jedem beliebigen Fenster von `windowMs`.
export class SlidingWindow {
  constructor(limit = 60, windowMs = 60000) { this.limit = limit; this.windowMs = windowMs; this.log = []; this.until = 0; }
  prune(now) { const from = now - this.windowMs; let i = 0; while (i < this.log.length && this.log[i] <= from) i++; if (i) this.log.splice(0, i); }
  /** bis zu n Freigaben; gibt die Anzahl der gewährten zurück. reserve: so viele Freigaben bleiben für Wichtigeres frei */
  take(n, now = Date.now(), reserve = 0) {
    this.prune(now);
    if (now < this.until) return 0;
    const k = Math.max(0, Math.min(n, this.limit - reserve - this.log.length));
    for (let i = 0; i < k; i++) this.log.push(now);
    return k;
  }
  /** nicht genutzte Freigaben zurückgeben (die zuletzt vergebenen) */
  give(n) { if (n > 0) this.log.splice(Math.max(0, this.log.length - n), n); }
  /** nach einer 429-Antwort der Bahn eine Weile nichts mehr freigeben */
  pause(ms, now = Date.now()) { this.until = Math.max(this.until, now + ms); }
  used(now = Date.now()) { this.prune(now); return this.log.length; }
  /** Millisekunden bis zur nächsten freien Freigabe */
  nextFree(now = Date.now()) { this.prune(now); return this.log.length < this.limit ? Math.max(0, this.until - now) : this.log[0] + this.windowMs - now; }
}
