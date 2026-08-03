// public/js/play.js – Player-View (strictly mobile first)
(function () {
  const { qs, el, esc, palette, syncClock, makeDeblur, secsLeft } = BR;
  const socket = BR.connect();

  let roomId = (qs('room') || '').toUpperCase();
  let me = null; // { playerId, token, name }
  let state = null; // letzter room:state
  let myAnswer = null; // { index, optionId }
  const deblur = makeDeblur(el('qImg'));

  const SECTIONS = ['join', 'lobby', 'question', 'reveal', 'ended'];
  function showSection(id) {
    SECTIONS.forEach((s) => el(s).classList.add('hidden'));
    el(id).classList.remove('hidden');
  }

  // ---- Beitritt vorbereiten ----
  if (!roomId) {
    el('codeWrap').classList.remove('hidden');
  } else {
    fetch(`/api/rooms/${encodeURIComponent(roomId)}/public`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((info) => { el('roomTitle').textContent = info.name; })
      .catch(() => { el('roomTitle').textContent = 'Raum nicht gefunden – Code prüfen'; el('codeWrap').classList.remove('hidden'); });
    // Auto-Reconnect, falls Session vorhanden
    const sess = BR.loadSession(roomId);
    if (sess && sess.playerId && sess.token) {
      socket.emit('player:resume', { roomId, playerId: sess.playerId, token: sess.token }, (res) => {
        if (res && res.ok) {
          me = { playerId: res.playerId, token: sess.token, name: res.name };
          if (res.alreadyAnswered) myAnswer = { index: res.state.questionIndex, optionId: res.yourOptionId };
          onJoined(res.state);
        } else {
          BR.clearSession(roomId);
        }
      });
    }
  }

  window.doJoin = function () {
    const err = el('joinErr');
    err.textContent = '';
    if (el('codeWrap') && !el('codeWrap').classList.contains('hidden')) {
      roomId = (el('room').value || '').trim().toUpperCase();
    }
    const password = el('password').value;
    const username = el('username').value.trim();
    if (!roomId) return (err.textContent = 'Bitte Raum-Code eingeben.');
    if (!username) return (err.textContent = 'Bitte einen Namen eingeben.');

    const btn = el('joinBtn');
    btn.disabled = true;
    socket.emit('player:join', { roomId, password, username }, (res) => {
      btn.disabled = false;
      if (!res || !res.ok) return (err.textContent = (res && res.error) || 'Beitritt fehlgeschlagen.');
      me = { playerId: res.playerId, token: res.token, name: username };
      BR.saveSession(roomId, { playerId: res.playerId, token: res.token });
      onJoined(res.state);
    });
  };
  ['password', 'username'].forEach((id) => el(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); }));

  function onJoined(initial) {
    el('bar').classList.remove('hidden');
    el('barName').textContent = me.name || '';
    if (initial) render(initial);
  }

  // ---- Echtzeit-Updates ----
  socket.on('room:state', (s) => { render(s); });
  socket.on('room:progress', () => {}); // (Beamer zeigt den Fortschritt)

  socket.on('you:result', (r) => {
    el('revealIcon').textContent = !r.answered ? '😴' : r.correct ? '✅' : '❌';
    el('revealTitle').textContent = !r.answered ? 'Nicht geantwortet' : r.correct ? 'Richtig!' : 'Leider falsch';
    el('revealPoints').innerHTML = r.correct ? `<b>+${r.points}</b> Punkte` : '<span class="text-white/60">+0 Punkte</span>';
    el('revealRank').textContent = r.rank ? `${r.rank}.` : '–';
    el('barScore').textContent = r.score ?? el('barScore').textContent;
    showSection('reveal');
    if (r.correct) navigator.vibrate?.(120);
  });

  socket.on('you:final', (r) => {
    el('finalRank').textContent = r.rank ? `${r.rank}.` : '–';
    el('finalScore').textContent = `${r.score} Punkte`;
    renderPodium();
    showSection('ended');
  });

  socket.on('connect', () => {
    // Nach Reconnect Sitzung wiederherstellen
    if (me && roomId) {
      socket.emit('player:resume', { roomId, playerId: me.playerId, token: me.token }, (res) => {
        if (res && res.ok) render(res.state);
      });
    }
  });

  // ---- Rendering ----
  function render(s) {
    state = s;
    syncClock(s.serverNow);
    if (me) el('barScore').textContent = (s.leaderboard.find((e) => e.id === me.playerId)?.score) ?? el('barScore').textContent;
    el('lobbyCount').textContent = s.playerCount;

    if (s.phase === 'lobby') { showSection('lobby'); return; }

    if (s.phase === 'question') {
      // neue Frage? -> Antwortstatus-Hinweis zurücksetzen
      if (!myAnswer || myAnswer.index !== s.questionIndex) el('answeredHint').classList.add('hidden');
      renderQuestion(s);
      showSection('question');
      return;
    }

    if (s.phase === 'reveal') {
      // Das persönliche Ergebnis kommt via you:result und zeigt die Auflösung
      // bereits mit Punkten/Rang. Nur falls wir spät beigetreten sind (kein
      // you:result erhalten) blenden wir einen neutralen Auflösungs-Screen ein.
      if (el('reveal').classList.contains('hidden')) {
        el('revealIcon').textContent = '💡';
        el('revealTitle').textContent = 'Auflösung';
        el('revealPoints').textContent = '';
        const mine = me && s.leaderboard.find((e) => e.id === me.playerId);
        el('revealRank').textContent = mine ? `${mine.rank}.` : '–';
        showSection('reveal');
      }
      return;
    }

    if (s.phase === 'ended') {
      renderPodium();
      // you:final zeigt Rang/Punkte; für spät Beigetretene hier absichern.
      if (el('ended').classList.contains('hidden')) {
        const mine = me && s.leaderboard.find((e) => e.id === me.playerId);
        el('finalRank').textContent = mine ? `${mine.rank}.` : '–';
        el('finalScore').textContent = mine ? `${mine.score} Punkte` : '0 Punkte';
        showSection('ended');
      }
      return;
    }
  }

  function renderQuestion(s) {
    const q = s.question;
    if (!q) return;
    el('qIndex').textContent = s.questionIndex + 1;
    el('qTotal').textContent = s.totalQuestions;
    el('qText').textContent = q.text || '';
    if (q.imageUrl) el('qImg').src = q.imageUrl;
    deblur.apply(s.phase, s.timer);

    const answered = myAnswer && myAnswer.index === s.questionIndex;
    const box = el('options');
    // Nur neu bauen, wenn sich die Frage geändert hat (verhindert Flackern).
    if (box.dataset.qid !== q.id) {
      box.dataset.qid = q.id;
      box.innerHTML = '';
      q.options.forEach((opt, i) => {
        const c = palette(i);
        const b = document.createElement('button');
        b.className = 'press pop w-full text-left rounded-2xl px-4 py-4 font-bold text-white flex items-center gap-3 shadow-lg';
        b.style.background = c.bg;
        b.style.animationDelay = i * 0.04 + 's';
        b.innerHTML = `<span class="text-2xl w-8 text-center opacity-90">${c.shape}</span><span class="flex-1">${esc(opt.text)}</span>`;
        b.__optId = opt.id;
        b.onclick = () => choose(opt.id, b);
        box.appendChild(b);
      });
    }
    // Zustand (bereits geantwortet?) anwenden
    Array.from(box.children).forEach((b) => {
      const isMine = answered && myAnswer.optionId === b.__optId;
      b.disabled = answered;
      b.style.opacity = answered && !isMine ? '0.45' : '1';
      b.classList.toggle('ring-4', !!isMine);
      b.classList.toggle('ring-white', !!isMine);
    });
    el('answeredHint').classList.toggle('hidden', !answered);
  }

  function choose(optionId, btn) {
    if (myAnswer && myAnswer.index === state.questionIndex) return;
    socket.emit('player:answer', { optionId }, (res) => {
      if (!res || !res.ok) {
        el('answeredHint').textContent = (res && res.error) || 'Konnte nicht senden.';
        el('answeredHint').classList.remove('hidden');
        return;
      }
      myAnswer = { index: state.questionIndex, optionId };
      // Buttons sperren + Auswahl markieren
      const box = el('options');
      Array.from(box.children).forEach((b) => {
        b.disabled = true;
        b.style.opacity = b === btn ? '1' : '0.45';
      });
      btn.classList.add('ring-4', 'ring-white', 'flash-ok');
      btn.__optId = optionId;
      el('answeredHint').textContent = '✅ Antwort gespeichert – warte auf Auflösung…';
      el('answeredHint').classList.remove('hidden');
      navigator.vibrate?.(40);
    });
  }

  function renderPodium() {
    if (!state) return;
    const box = el('podium');
    box.innerHTML = '<div class="text-white/60 text-sm mb-1">Top 3</div>' +
      state.leaderboard.slice(0, 3).map((e) => {
        const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : '🥉';
        const meMark = me && e.id === me.playerId ? ' ring-2 ring-pink-400' : '';
        return `<div class="flex items-center gap-3 bg-white/10 rounded-xl px-4 py-2${meMark}">
            <span class="text-2xl">${medal}</span>
            <span class="flex-1 font-bold truncate">${esc(e.name)}</span>
            <span class="font-black">${e.score}</span>
          </div>`;
      }).join('');
  }

  // ---- Countdown-Ticker ----
  setInterval(() => {
    if (state && state.phase === 'question') el('qTimer').textContent = secsLeft(state.timer);
  }, 200);
})();
