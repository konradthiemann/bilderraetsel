// public/js/beamer.js – Spectator / Beamer-View (Leinwand)
(function () {
  const { qs, el, esc, palette, syncClock, makeDeblur, secsLeft, renderRing } = BR;
  const socket = BR.connect();
  const roomId = (qs('room') || '').toUpperCase();

  let state = null;
  const deblur = makeDeblur(el('qImg'));

  const SECTIONS = ['pick', 'lobby', 'question', 'reveal', 'ended'];
  function showSection(id) {
    SECTIONS.forEach((s) => el(s) && el(s).classList.add('hidden'));
    el(id).classList.remove('hidden');
    el('head').classList.toggle('hidden', id === 'pick');
  }

  if (!roomId) { showSection('pick'); return; }

  // QR-Code + Beitritts-URL laden
  fetch(`/api/rooms/${encodeURIComponent(roomId)}/qr`)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((info) => {
      el('qr').src = info.dataUrl;
      el('joinUrl').textContent = info.joinUrl.replace(/^https?:\/\//, '');
      el('lobbyCode').textContent = roomId;
      el('roomName').textContent = info.roomName;
    })
    .catch(() => { el('roomName').textContent = 'Raum nicht gefunden'; });

  socket.on('connect', () => {
    socket.emit('spectator:join', { roomId }, (res) => {
      if (res && res.ok) render(res.state);
      else el('roomName').textContent = (res && res.error) || 'Fehler';
    });
  });

  socket.on('room:state', render);
  socket.on('room:progress', (p) => {
    el('answeredCount').textContent = p.answeredCount;
    el('answeredTotal').textContent = p.playerCount;
  });

  function render(s) {
    state = s;
    syncClock(s.serverNow);
    if (s.roomName) el('roomName').textContent = s.roomName;
    el('qTotal').textContent = s.totalQuestions;
    el('qIndex').textContent = s.questionIndex + 1;
    el('answeredCount').textContent = s.answeredCount || 0;
    el('answeredTotal').textContent = s.playerCount || 0;
    el('progressWrap').classList.toggle('hidden', s.phase === 'lobby' || s.phase === 'ended');

    if (s.phase === 'lobby') return renderLobby(s);
    if (s.phase === 'question') return renderQuestion(s);
    if (s.phase === 'reveal') return renderReveal(s);
    if (s.phase === 'ended') return renderEnded(s);
  }

  // ---- Lobby ----
  function renderLobby(s) {
    el('lobbyCount').textContent = s.playerCount;
    const grid = el('playerGrid');
    grid.innerHTML = s.players.map((p) => {
      const dim = p.connected ? '' : 'opacity-40';
      return `<span class="pop ${dim} bg-white/15 border border-white/10 rounded-full px-4 py-2 font-bold">${esc(p.name)}</span>`;
    }).join('') || '<span class="text-white/40">Noch niemand da…</span>';
    showSection('lobby');
  }

  // ---- Frage ----
  function renderQuestion(s) {
    const q = s.question;
    if (q) {
      if (q.imageUrl) el('qImg').src = q.imageUrl;
      el('qText').textContent = q.text || '';
      const box = el('options');
      if (box.dataset.qid !== q.id) {
        box.dataset.qid = q.id;
        box.innerHTML = q.options.map((opt, i) => {
          const c = palette(i);
          return `<div class="rounded-2xl px-5 py-3 font-bold text-white flex items-center gap-3 text-xl shadow-lg" style="background:${c.bg}">
              <span class="text-2xl opacity-90">${c.shape}</span><span>${esc(opt.text)}</span>
            </div>`;
        }).join('');
      }
    }
    deblur.apply(s.phase, s.timer);
    showSection('question');
  }

  // ---- Auflösung ----
  function renderReveal(s) {
    const q = s.question;
    if (q) {
      if (q.imageUrl) el('rImg').src = q.imageUrl;
      el('rText').textContent = q.text || '';
      const counts = s.optionCounts || {};
      const total = Object.values(counts).reduce((a, b) => a + b, 0) || 0;
      el('rOptions').innerHTML = q.options.map((opt, i) => {
        const c = palette(i);
        const correct = opt.id === q.correctOptionId;
        const n = counts[opt.id] || 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        const ring = correct ? 'ring-4 ring-emerald-300' : 'opacity-60';
        const mark = correct ? '✓' : '';
        return `<div class="relative rounded-2xl px-4 py-3 font-bold text-white overflow-hidden ${ring}" style="background:${c.bg}">
            <div class="absolute inset-y-0 left-0 bg-black/25" style="width:${pct}%"></div>
            <div class="relative flex items-center gap-2">
              <span class="text-xl">${c.shape}</span>
              <span class="flex-1">${esc(opt.text)}</span>
              <span class="text-lg">${mark} ${n}</span>
            </div>
          </div>`;
      }).join('');
    }
    renderBoard(el('board'), s.leaderboard, true);
    showSection('reveal');
  }

  // ---- Ende ----
  function renderEnded(s) {
    renderBoard(el('finalBoard'), s.leaderboard, true, true);
    showSection('ended');
  }

  function renderBoard(container, board, animate, big) {
    if (!container) return;
    container.innerHTML = board.map((e) => {
      const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `${e.rank}.`;
      const size = big ? 'text-xl md:text-2xl py-3' : 'py-2';
      const top = e.rank <= 3 ? 'bg-white/20' : 'bg-white/10';
      return `<div class="${animate ? 'pop' : ''} ${top} rounded-2xl px-4 ${size} flex items-center gap-4 border border-white/10">
          <span class="w-10 text-center text-2xl font-black">${medal}</span>
          <span class="flex-1 font-bold truncate">${esc(e.name)}</span>
          <span class="font-black tabular-nums">${e.score}</span>
        </div>`;
    }).join('') || '<div class="text-white/40">Noch keine Punkte…</div>';
  }

  // ---- Ticker für Ring & Zahl ----
  setInterval(() => {
    if (state && state.phase === 'question') {
      el('ringNum').textContent = secsLeft(state.timer);
      renderRing(el('ring'), state.timer);
    }
  }, 100);
})();
