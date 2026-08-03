// public/js/admin.js – Admin / Gamemaster (mobile first für den Host-Teil)
(function () {
  const { qs, el, esc, palette, syncClock, secsLeft } = BR;
  const socket = BR.connect();

  const KEY = 'br:adminKey';
  let adminKey = localStorage.getItem(KEY) || '';
  let rooms = [];
  let currentRoom = null; // Admin-Ansicht des aktuell offenen Raums
  let hostState = null; // letzter adminState beim Hosten
  let form = { options: [], correctIndex: 0 };

  const VIEWS = ['login', 'dash', 'editor', 'host'];
  function view(id) {
    VIEWS.forEach((v) => el(v).classList.add('hidden'));
    el(id).classList.remove('hidden');
  }

  // ---- API-Helfer ----
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminKey, ...(opts.headers || {}) },
    });
    if (res.status === 401) { logout(); throw new Error('Nicht autorisiert.'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Fehler');
    return data;
  }

  // ================= Host-Link-Modus (ohne Admin-Passwort) =================
  const linkRoom = (qs('room') || '').toUpperCase();
  const linkHost = qs('host');
  if (linkRoom && linkHost) {
    startHosting(linkRoom, { hostToken: linkHost, viaLink: true });
  } else if (adminKey) {
    loadDash();
  } else {
    view('login');
  }

  // ================= Login =================
  window.doLogin = async function () {
    const err = el('loginErr'); err.textContent = '';
    el('loginBtn').disabled = true;
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: el('adminPw').value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login fehlgeschlagen.');
      adminKey = data.adminKey;
      localStorage.setItem(KEY, adminKey);
      loadDash();
    } catch (e) { err.textContent = e.message; }
    finally { el('loginBtn').disabled = false; }
  };
  el('adminPw').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

  window.logout = function () {
    localStorage.removeItem(KEY); adminKey = '';
    view('login');
  };

  // ================= Dashboard =================
  async function loadDash() {
    view('dash');
    try {
      const { rooms: list } = await api('/api/rooms');
      rooms = list;
      renderRooms();
    } catch (e) { /* 401 -> logout already */ }
  }
  window.backToDash = loadDash;

  function renderRooms() {
    const box = el('roomList');
    if (!rooms.length) { box.innerHTML = '<p class="text-white/40">Noch keine Spiele. Lege oben eins an.</p>'; return; }
    box.innerHTML = rooms.map((r) => `
      <div class="bg-white/10 rounded-2xl p-4 border border-white/10">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="font-black text-lg truncate">${esc(r.name)}</div>
            <div class="text-white/50 text-sm">Code <span class="font-mono font-bold text-pink-300">${r.id}</span> · ${r.questionCount} Fragen</div>
          </div>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          <button onclick="openHost('${r.id}')" class="press bg-emerald-500 hover:bg-emerald-400 font-bold py-2 rounded-xl text-sm">🎙️ Hosten</button>
          <button onclick="openEditor('${r.id}')" class="press bg-indigo-500 hover:bg-indigo-400 font-bold py-2 rounded-xl text-sm">✏️ Fragen</button>
          <a href="/beamer?room=${r.id}" target="_blank" class="press text-center bg-white/15 hover:bg-white/25 font-bold py-2 rounded-xl text-sm">📺 Beamer</a>
          <button onclick="deleteRoom('${r.id}')" class="press bg-red-500/70 hover:bg-red-500 font-bold py-2 rounded-xl text-sm">🗑️ Löschen</button>
        </div>
      </div>`).join('');
  }

  window.createRoom = async function () {
    const name = el('newName').value.trim();
    const password = el('newPass').value;
    const answerOptionsDefault = Number(el('newOpts').value);
    if (!password) return alert('Bitte ein Raum-Passwort vergeben.');
    try {
      await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name, password, answerOptionsDefault }) });
      el('newName').value = ''; el('newPass').value = '';
      loadDash();
    } catch (e) { alert(e.message); }
  };

  window.deleteRoom = async function (id) {
    const name = (rooms.find((r) => r.id === id) || {}).name || id;
    if (!confirm(`Spiel „${name}" wirklich löschen? Alle Fragen gehen verloren.`)) return;
    try { await api('/api/rooms/' + id, { method: 'DELETE' }); loadDash(); }
    catch (e) { alert(e.message); }
  };

  // ================= Fragen-Editor =================
  window.openEditor = async function (id) {
    try {
      const { room } = await api('/api/rooms/' + id);
      currentRoom = room;
      el('edRoomName').textContent = room.name;
      el('edRoomCode').textContent = room.id;
      resetForm();
      renderQuestions();
      view('editor');
    } catch (e) { alert(e.message); }
  };

  function renderQuestions() {
    el('edCount').textContent = currentRoom.questions.length;
    el('questionList').innerHTML = currentRoom.questions.map((q, idx) => {
      const correct = q.options.find((o) => o.id === q.correctOptionId);
      const thumb = q.imageUrl
        ? `<img src="${esc(q.imageUrl)}" class="w-16 h-12 object-cover rounded-lg shrink-0" />`
        : '<div class="w-16 h-12 rounded-lg bg-black/40 shrink-0"></div>';
      return `<div class="bg-white/10 rounded-xl p-3 border border-white/10 flex items-center gap-3">
          <span class="text-white/40 font-bold w-5 text-center">${idx + 1}</span>
          ${thumb}
          <div class="min-w-0 flex-1">
            <div class="font-bold truncate">${esc(q.text) || '<em class="text-white/40">ohne Text</em>'}</div>
            <div class="text-emerald-300 text-sm truncate">✓ ${esc(correct ? correct.text : '?')}</div>
          </div>
          <button onclick="editQuestion('${q.id}')" class="press text-indigo-300 px-2">✏️</button>
          <button onclick="delQuestion('${q.id}')" class="press text-red-300 px-2">🗑️</button>
        </div>`;
    }).join('') || '<p class="text-white/40">Noch keine Fragen.</p>';
  }

  window.resetForm = function () {
    el('edQid').value = '';
    el('edText').value = '';
    el('edImageUrl').value = '';
    el('edPreview').classList.add('hidden');
    el('edNoImg').classList.remove('hidden');
    el('edUpStatus').textContent = '';
    el('edErr').textContent = '';
    el('edFormTitle').textContent = 'Neue Frage';
    const n = currentRoom ? currentRoom.answerOptionsDefault : 4;
    form = { options: Array.from({ length: n }, () => ({ text: '' })), correctIndex: 0 };
    renderOptions();
  };

  function renderOptions() {
    const box = el('edOptions');
    box.innerHTML = form.options.map((o, i) => {
      const c = palette(i);
      return `<div class="flex items-center gap-2">
          <input type="radio" name="correct" ${i === form.correctIndex ? 'checked' : ''} onchange="setCorrect(${i})" class="w-5 h-5 accent-emerald-400" />
          <span class="w-7 text-center text-xl" style="color:${c.bg}">${c.shape}</span>
          <input value="${esc(o.text)}" oninput="setOpt(${i}, this.value)" placeholder="Antwort ${i + 1}"
            class="flex-1 bg-black/30 rounded-lg px-3 py-2 outline-none focus:ring-2 ring-pink-400" />
          <button onclick="removeOption(${i})" class="press text-red-300 px-2 ${form.options.length <= 2 ? 'opacity-30 pointer-events-none' : ''}">✕</button>
        </div>`;
    }).join('');
    el('edAddOpt').style.display = form.options.length >= 6 ? 'none' : '';
  }
  window.setOpt = (i, v) => { form.options[i].text = v; };
  window.setCorrect = (i) => { form.correctIndex = i; };
  window.addOption = () => { if (form.options.length < 6) { form.options.push({ text: '' }); renderOptions(); } };
  window.removeOption = (i) => {
    if (form.options.length <= 2) return;
    form.options.splice(i, 1);
    if (form.correctIndex >= form.options.length) form.correctIndex = 0;
    else if (form.correctIndex > i) form.correctIndex--;
    renderOptions();
  };

  window.uploadImage = async function (input) {
    const file = input.files && input.files[0];
    if (!file) return;
    el('edUpStatus').textContent = 'Lade hoch…';
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + adminKey }, body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
      el('edImageUrl').value = data.imageUrl;
      el('edPreview').src = data.imageUrl;
      el('edPreview').classList.remove('hidden');
      el('edNoImg').classList.add('hidden');
      el('edUpStatus').textContent = '✓';
    } catch (e) { el('edUpStatus').textContent = e.message; }
    input.value = '';
  };

  window.editQuestion = function (qid) {
    const q = currentRoom.questions.find((x) => x.id === qid);
    if (!q) return;
    el('edQid').value = q.id;
    el('edText').value = q.text || '';
    el('edImageUrl').value = q.imageUrl || '';
    el('edFormTitle').textContent = 'Frage bearbeiten';
    if (q.imageUrl) { el('edPreview').src = q.imageUrl; el('edPreview').classList.remove('hidden'); el('edNoImg').classList.add('hidden'); }
    else { el('edPreview').classList.add('hidden'); el('edNoImg').classList.remove('hidden'); }
    form.options = q.options.map((o) => ({ id: o.id, text: o.text }));
    form.correctIndex = Math.max(0, q.options.findIndex((o) => o.id === q.correctOptionId));
    renderOptions();
    el('editor').scrollIntoView({ behavior: 'smooth' });
  };

  window.delQuestion = async function (qid) {
    if (!confirm('Frage löschen?')) return;
    try {
      await api(`/api/rooms/${currentRoom.id}/questions/${qid}`, { method: 'DELETE' });
      const { room } = await api('/api/rooms/' + currentRoom.id);
      currentRoom = room; renderQuestions();
    } catch (e) { alert(e.message); }
  };

  window.saveQuestion = async function () {
    const err = el('edErr'); err.textContent = '';
    const payload = {
      text: el('edText').value.trim(),
      imageUrl: el('edImageUrl').value,
      options: form.options.map((o) => ({ id: o.id, text: o.text })),
      correctIndex: form.correctIndex,
    };
    const qid = el('edQid').value;
    try {
      if (qid) await api(`/api/rooms/${currentRoom.id}/questions/${qid}`, { method: 'PUT', body: JSON.stringify(payload) });
      else await api(`/api/rooms/${currentRoom.id}/questions`, { method: 'POST', body: JSON.stringify(payload) });
      const { room } = await api('/api/rooms/' + currentRoom.id);
      currentRoom = room;
      resetForm();
      renderQuestions();
    } catch (e) { err.textContent = e.message; }
  };

  // ================= Gamemaster / Host =================
  window.openHost = function (id) { startHosting(id, { adminKey }); };

  function startHosting(roomId, auth) {
    el('hostBack').style.display = auth.viaLink ? 'none' : '';
    socket.emit('admin:host', { roomId, adminKey: auth.adminKey, hostToken: auth.hostToken }, (res) => {
      if (!res || !res.ok) {
        if (auth.viaLink) { document.body.innerHTML = `<div class="min-h-screen flex items-center justify-center text-center p-8"><div><div class="text-5xl mb-2">🚫</div><p class="text-xl font-bold">${(res && res.error) || 'Zugriff verweigert'}</p></div></div>`; }
        else alert((res && res.error) || 'Konnte nicht hosten.');
        return;
      }
      currentRoom = res.room;
      el('openBeamer').href = `/beamer?room=${roomId}`;
      el('hostCode').textContent = roomId;
      el('hostRoomName').textContent = res.room.name;
      renderHost(res.state);
      view('host');
    });
  }

  // Der Host bekommt bei JEDER Änderung ein admin:state (Transition via
  // broadcast(), Antworten via broadcastAdmin()) -> room:state ist hier
  // redundant und würde die Live-Statistik flackern lassen.
  socket.on('admin:state', (s) => { if (el('host').classList.contains('hidden')) return; renderHost(s); });

  window.cmd = function (action) {
    socket.emit('admin:command', { action }, (res) => {
      if (res && res.error) alert(res.error);
    });
  };
  window.togglePause = function () {
    if (!hostState) return;
    cmd(hostState.timer && hostState.timer.paused ? 'resume' : 'pause');
  };

  function renderHost(s) {
    hostState = s;
    syncClock(s.serverNow);
    const phaseLabel = { lobby: '⏳ Lobby', question: '❓ Frage läuft', reveal: '💡 Auflösung', ended: '🏁 Ende' }[s.phase] || s.phase;
    el('hostPhase').textContent = phaseLabel;
    el('hostPlayers').textContent = s.playerCount;

    // Buttons je Phase
    const isQ = s.phase === 'question';
    show('btnStart', s.phase === 'lobby');
    show('btnNext', s.phase === 'reveal');
    show('btnPause', isQ);
    show('btnReveal', isQ);
    show('hostTimer', isQ);
    show('livePanel', isQ || s.phase === 'reveal');
    show('hostQInfo', isQ || s.phase === 'reveal');
    el('btnPause').textContent = s.timer && s.timer.paused ? '▶️ Fortsetzen' : '⏸️ Pause';

    // Aktuelle Frage (mit korrekter Antwort für den Moderator)
    if ((isQ || s.phase === 'reveal') && s.question) {
      el('hostQIdx').textContent = s.questionIndex + 1;
      el('hostQTotal').textContent = s.totalQuestions;
      el('hostQText').textContent = s.question.text || '(kein Text)';
      const correctId = s.correctOptionId || s.question.correctOptionId;
      const correct = s.question.options.find((o) => o.id === correctId);
      el('hostCorrect').textContent = correct ? correct.text : '—';
    }

    // Live: wer fehlt + Verteilung
    if (s.unanswered) {
      el('liveAnswered').textContent = s.answeredCount || 0;
      el('livePlayers').textContent = s.playerCount || 0;
      el('liveMissing').innerHTML = s.unanswered.length
        ? s.unanswered.map((n) => `<span class="bg-amber-500/20 text-amber-200 border border-amber-400/30 rounded-full px-3 py-1 text-sm font-bold">${esc(n)}</span>`).join('')
        : '<span class="text-emerald-300 font-bold">Alle haben geantwortet 🎉</span>';
      renderCounts(s);
    }

    renderHostBoard(s.leaderboard || []);
  }

  function renderCounts(s) {
    if (!s.question || !s.optionCounts) { el('liveCounts').innerHTML = ''; return; }
    const total = Object.values(s.optionCounts).reduce((a, b) => a + b, 0) || 0;
    el('liveCounts').innerHTML = s.question.options.map((opt, i) => {
      const c = palette(i);
      const n = s.optionCounts[opt.id] || 0;
      const pct = total ? Math.round((n / total) * 100) : 0;
      const correctId = s.correctOptionId || s.question.correctOptionId;
      const isC = opt.id === correctId ? '✓' : '';
      return `<div class="relative rounded-lg overflow-hidden bg-black/30">
          <div class="absolute inset-y-0 left-0" style="width:${pct}%;background:${c.bg};opacity:.5"></div>
          <div class="relative flex items-center gap-2 px-2 py-1 text-sm">
            <span style="color:${c.bg}">${c.shape}</span>
            <span class="flex-1 truncate">${esc(opt.text)}</span>
            <span class="text-emerald-300">${isC}</span><span class="font-bold">${n}</span>
          </div>
        </div>`;
    }).join('');
  }

  function renderHostBoard(board) {
    el('hostBoard').innerHTML = board.slice(0, 5).map((e) => {
      const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `${e.rank}.`;
      return `<div class="flex items-center gap-3 text-sm">
          <span class="w-6 text-center">${medal}</span>
          <span class="flex-1 font-bold truncate">${esc(e.name)}</span>
          <span class="font-black">${e.score}</span>
        </div>`;
    }).join('') || '<div class="text-white/40 text-sm">—</div>';
  }

  function show(id, on) { el(id).classList.toggle('hidden', !on); }

  // ---- Countdown-Ticker (Host) ----
  setInterval(() => {
    if (hostState && hostState.phase === 'question' && !el('host').classList.contains('hidden')) {
      el('hostTimer').textContent = secsLeft(hostState.timer);
    }
  }, 200);
})();
