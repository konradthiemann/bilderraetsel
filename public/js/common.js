// public/js/common.js
// Geteilte Client-Helfer für alle drei Views. Exponiert window.BR.

window.BR = (function () {
  const params = new URLSearchParams(location.search);
  const qs = (name) => params.get(name);
  const el = (id) => document.getElementById(id);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Antwort-Farben & -Formen (bis zu 6 Optionen), Kahoot-inspiriert.
  const PALETTE = [
    { bg: '#e21b3c', shape: '▲', name: 'Rot' },
    { bg: '#1368ce', shape: '◆', name: 'Blau' },
    { bg: '#d89e00', shape: '●', name: 'Gelb' },
    { bg: '#26890c', shape: '■', name: 'Grün' },
    { bg: '#7b2ff7', shape: '★', name: 'Lila' },
    { bg: '#e8590c', shape: '⬢', name: 'Orange' },
  ];
  const palette = (i) => PALETTE[i % PALETTE.length];

  // ---- Server<->Client Uhr-Synchronisation ----
  let clockOffset = 0;
  function syncClock(serverNow) {
    if (typeof serverNow === 'number') clockOffset = serverNow - Date.now();
  }
  const serverNowEst = () => Date.now() + clockOffset;

  function timerElapsed(timer) {
    if (!timer) return 0;
    if (timer.paused) return timer.elapsedBeforePause;
    return timer.elapsedBeforePause + Math.max(0, serverNowEst() - timer.startedAt);
  }
  function timerRemaining(timer) {
    if (!timer) return 0;
    return Math.max(0, timer.duration - timerElapsed(timer));
  }
  const secsLeft = (timer) => Math.ceil(timerRemaining(timer) / 1000);

  // ---- Countdown-Ring aktualisieren ----
  function renderRing(ringEl, timer) {
    if (!ringEl || !timer) return;
    const frac = timer.duration ? timerRemaining(timer) / timer.duration : 0;
    const p = Math.max(0, Math.min(100, frac * 100));
    ringEl.style.setProperty('--p', p.toFixed(1));
    const color = frac > 0.5 ? '#22c55e' : frac > 0.2 ? '#f59e0b' : '#ef4444';
    ringEl.style.setProperty('--ring', color);
  }

  // ---- De-Blur-Controller für ein <img> ----
  // Setzt die @keyframes-Animation nur neu, wenn sich die Timer-Parameter
  // ändern (Start/Pause/Resume/neue Frage) -> kein Ruckeln bei State-Updates.
  function makeDeblur(imgEl) {
    let sig = null;
    return {
      apply(phase, timer) {
        if (!imgEl) return;
        if (phase !== 'question') {
          imgEl.style.animation = 'none';
          imgEl.style.filter = 'blur(0px)';
          imgEl.style.transform = 'scale(1)';
          sig = null;
          return;
        }
        const elapsed = timerElapsed(timer);
        const s = `${timer.startedAt}|${timer.paused}|${timer.elapsedBeforePause}|${timer.duration}`;
        if (s === sig) return;
        sig = s;
        imgEl.style.filter = '';
        imgEl.style.transform = '';
        imgEl.style.animation = 'none';
        void imgEl.offsetWidth; // Reflow erzwingen
        imgEl.style.animation = `deblur ${timer.duration}ms linear ${-elapsed}ms forwards`;
        imgEl.style.animationPlayState = timer.paused ? 'paused' : 'running';
      },
    };
  }

  const connect = () => io(); // socket.io vom selben Origin

  // ---- Session-Persistenz (Reconnect nach Reload) ----
  const key = (roomId) => 'br:' + roomId;
  function saveSession(roomId, data) {
    try { localStorage.setItem(key(roomId), JSON.stringify(data)); } catch {}
  }
  function loadSession(roomId) {
    try { return JSON.parse(localStorage.getItem(key(roomId)) || 'null'); } catch { return null; }
  }
  function clearSession(roomId) {
    try { localStorage.removeItem(key(roomId)); } catch {}
  }

  function show(id) { const e = el(id); if (e) e.classList.remove('hidden'); }
  function hide(id) { const e = el(id); if (e) e.classList.add('hidden'); }
  function only(ids, visibleId) {
    ids.forEach((i) => hide(i));
    show(visibleId);
  }

  return {
    qs, el, esc, PALETTE, palette,
    syncClock, serverNowEst, timerElapsed, timerRemaining, secsLeft, renderRing,
    makeDeblur, connect, saveSession, loadSession, clearSession,
    show, hide, only,
  };
})();
