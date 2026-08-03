// src/game.js
// Flüchtiger Laufzeit-Zustand eines Spiels (pro Raum) als kleine State-Machine.
// Der Server ist die einzige Wahrheit für Timing & Punkte (kein Client-Cheat).
//
// Phasen:  lobby -> question -> reveal -> (question -> reveal)* -> ended
//
// Timer-Modell (pausierbar):
//   elapsed(now) = paused ? elapsedBeforePause
//                         : elapsedBeforePause + (now - startedAt)
// Beim Pausieren wird der laufende Abschnitt in elapsedBeforePause "eingefroren".

import { getRoom, shortId, token as makeToken } from './store.js';
import { calculatePoints, buildLeaderboard, QUESTION_DURATION_MS } from './scoring.js';

export const PHASES = {
  LOBBY: 'lobby',
  QUESTION: 'question',
  REVEAL: 'reveal',
  ENDED: 'ended',
};

export const adminChannel = (roomId) => `admin::${roomId}`;

class RoomRuntime {
  constructor(roomId, io) {
    this.roomId = roomId;
    this.io = io;
    this.phase = PHASES.LOBBY;
    this.currentIndex = -1;
    /** @type {Map<string, {id,name,token,score,connected,socketId}>} */
    this.players = new Map();
    /** @type {Map<string, {optionId,points,correct,elapsedMs}>} pro aktueller Frage */
    this.answers = new Map();
    this.timer = {
      duration: QUESTION_DURATION_MS,
      startedAt: 0,
      elapsedBeforePause: 0,
      paused: false,
    };
    this._timeout = null;
  }

  get room() {
    return getRoom(this.roomId);
  }

  currentQuestion() {
    const room = this.room;
    if (!room || this.currentIndex < 0) return null;
    return room.questions[this.currentIndex] || null;
  }

  // ---- Spieler ----------------------------------------------------------
  addPlayer(name, socketId) {
    const player = {
      id: shortId(6),
      name,
      token: makeToken(12),
      score: 0,
      connected: true,
      socketId,
    };
    this.players.set(player.id, player);
    return player;
  }

  resumePlayer(playerId, token, socketId) {
    const p = this.players.get(playerId);
    if (!p || p.token !== token) return null;
    p.connected = true;
    p.socketId = socketId;
    return p;
  }

  setConnected(playerId, connected) {
    const p = this.players.get(playerId);
    if (p) p.connected = connected;
  }

  nameTaken(name) {
    const lower = name.toLowerCase();
    return [...this.players.values()].some((p) => p.connected && p.name.toLowerCase() === lower);
  }

  // ---- Timer-Helfer -----------------------------------------------------
  nowElapsed() {
    if (this.timer.paused) return this.timer.elapsedBeforePause;
    return this.timer.elapsedBeforePause + (Date.now() - this.timer.startedAt);
  }

  _armTimeout() {
    this._clearTimeout();
    const remaining = this.timer.duration - this.nowElapsed();
    if (remaining <= 0) {
      this.endQuestion();
      return;
    }
    this._timeout = setTimeout(() => this.endQuestion(), remaining);
  }

  _clearTimeout() {
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
  }

  // ---- Übergänge (vom Gamemaster ausgelöst) -----------------------------
  startGame() {
    const room = this.room;
    if (!room || room.questions.length === 0) {
      return { ok: false, error: 'Dieses Spiel hat noch keine Fragen.' };
    }
    // Punkte zu Spielbeginn zurücksetzen (frische Runde).
    for (const p of this.players.values()) p.score = 0;
    this._gotoQuestion(0);
    return { ok: true };
  }

  nextQuestion() {
    const room = this.room;
    if (!room) return { ok: false, error: 'Raum weg.' };
    const next = this.currentIndex + 1;
    if (next >= room.questions.length) {
      this.endGame();
      return { ok: true, ended: true };
    }
    this._gotoQuestion(next);
    return { ok: true };
  }

  _gotoQuestion(index) {
    this.answers = new Map();
    this.currentIndex = index;
    this.phase = PHASES.QUESTION;
    this.timer = {
      duration: QUESTION_DURATION_MS,
      startedAt: Date.now(),
      elapsedBeforePause: 0,
      paused: false,
    };
    this._armTimeout();
    this.broadcast();
  }

  pause() {
    if (this.phase !== PHASES.QUESTION || this.timer.paused) return { ok: false };
    this.timer.elapsedBeforePause = this.nowElapsed();
    this.timer.paused = true;
    this._clearTimeout();
    this.broadcast();
    return { ok: true };
  }

  resume() {
    if (this.phase !== PHASES.QUESTION || !this.timer.paused) return { ok: false };
    this.timer.startedAt = Date.now();
    this.timer.paused = false;
    this._armTimeout();
    this.broadcast();
    return { ok: true };
  }

  /** Frage sofort beenden -> Auflösung + Zwischen-Leaderboard. */
  endQuestion() {
    if (this.phase !== PHASES.QUESTION) return { ok: false };
    this._clearTimeout();
    // Timer bei Endstand einfrieren.
    this.timer.elapsedBeforePause = Math.min(this.timer.duration, this.nowElapsed());
    this.timer.paused = true;
    this.phase = PHASES.REVEAL;

    // Persönliche Ergebnisse an jeden Spieler (korrekt? Punkte? Rang?).
    const ranking = buildLeaderboard([...this.players.values()], Number.MAX_SAFE_INTEGER);
    const rankById = new Map(ranking.map((e) => [e.id, e.rank]));
    const q = this.currentQuestion();
    for (const p of this.players.values()) {
      const a = this.answers.get(p.id);
      this.io.to(p.socketId).emit('you:result', {
        answered: !!a,
        correct: a ? a.correct : false,
        points: a ? a.points : 0,
        yourOptionId: a ? a.optionId : null,
        correctOptionId: q ? q.correctOptionId : null,
        score: p.score,
        rank: rankById.get(p.id) ?? null,
        totalPlayers: this.players.size,
      });
    }
    this.broadcast();
    return { ok: true };
  }

  endGame() {
    this._clearTimeout();
    this.phase = PHASES.ENDED;
    const ranking = buildLeaderboard([...this.players.values()], Number.MAX_SAFE_INTEGER);
    const rankById = new Map(ranking.map((e) => [e.id, e.rank]));
    for (const p of this.players.values()) {
      this.io.to(p.socketId).emit('you:final', {
        score: p.score,
        rank: rankById.get(p.id) ?? null,
        totalPlayers: this.players.size,
      });
    }
    this.broadcast();
    return { ok: true };
  }

  resetGame() {
    this._clearTimeout();
    this.phase = PHASES.LOBBY;
    this.currentIndex = -1;
    this.answers = new Map();
    this.timer = { duration: QUESTION_DURATION_MS, startedAt: 0, elapsedBeforePause: 0, paused: false };
    for (const p of this.players.values()) p.score = 0;
    this.broadcast();
    return { ok: true };
  }

  // ---- Antwort abgeben --------------------------------------------------
  submitAnswer(playerId, optionId) {
    if (this.phase !== PHASES.QUESTION) return { ok: false, error: 'Gerade läuft keine Frage.' };
    const player = this.players.get(playerId);
    if (!player) return { ok: false, error: 'Unbekannter Spieler.' };
    if (this.answers.has(playerId)) return { ok: false, error: 'Du hast bereits geantwortet.' };
    const q = this.currentQuestion();
    if (!q) return { ok: false, error: 'Keine aktive Frage.' };
    if (!q.options.some((o) => o.id === optionId)) {
      return { ok: false, error: 'Ungültige Option.' };
    }

    const elapsedMs = Math.min(this.timer.duration, this.nowElapsed());
    const correct = optionId === q.correctOptionId;
    const points = calculatePoints(correct, elapsedMs, this.timer.duration);

    this.answers.set(playerId, { optionId, points, correct, elapsedMs });
    player.score += points;

    // Fortschritt an alle (ohne zu verraten, was richtig ist) + Host-Stats.
    this.io.to(this.roomId).emit('room:progress', {
      answeredCount: this.answers.size,
      playerCount: this.players.size,
    });
    this.broadcastAdmin();

    // Bewusst OHNE correct/points -> Spannung bleibt bis zur Auflösung.
    return { ok: true, accepted: true };
  }

  // ---- State-Snapshots --------------------------------------------------
  _questionPublic(withCorrect) {
    const q = this.currentQuestion();
    if (!q) return null;
    const out = {
      id: q.id,
      text: q.text,
      imageUrl: q.imageUrl,
      options: q.options.map((o) => ({ id: o.id, text: o.text })),
    };
    if (withCorrect) out.correctOptionId = q.correctOptionId;
    return out;
  }

  optionCounts() {
    const counts = {};
    const q = this.currentQuestion();
    if (q) for (const o of q.options) counts[o.id] = 0;
    for (const a of this.answers.values()) {
      counts[a.optionId] = (counts[a.optionId] || 0) + 1;
    }
    return counts;
  }

  timerState() {
    return {
      duration: this.timer.duration,
      startedAt: this.timer.startedAt,
      elapsedBeforePause: this.timer.elapsedBeforePause,
      paused: this.timer.paused,
      elapsed: this.nowElapsed(),
    };
  }

  /** Öffentlicher Zustand (Spieler & Beamer) – NIE die richtige Antwort während der Frage. */
  publicState() {
    const room = this.room;
    const revealing = this.phase === PHASES.REVEAL || this.phase === PHASES.ENDED;
    return {
      roomId: this.roomId,
      roomName: room?.name || '',
      phase: this.phase,
      questionIndex: this.currentIndex,
      totalQuestions: room?.questions.length || 0,
      question:
        this.phase === PHASES.QUESTION || this.phase === PHASES.REVEAL
          ? this._questionPublic(revealing)
          : null,
      optionCounts: revealing ? this.optionCounts() : null,
      answeredCount: this.answers.size,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
      })),
      playerCount: this.players.size,
      leaderboard: buildLeaderboard([...this.players.values()], 10),
      timer: this.timerState(),
      serverNow: Date.now(),
    };
  }

  /** Erweiterter Zustand nur für den Gamemaster (kennt Antwort + wer fehlt). */
  adminState() {
    const base = this.publicState();
    const q = this.currentQuestion();
    return {
      ...base,
      hostView: true,
      correctOptionId: q ? q.correctOptionId : null,
      optionCounts: this.optionCounts(),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        hasAnswered: this.answers.has(p.id),
      })),
      unanswered: [...this.players.values()]
        .filter((p) => p.connected && !this.answers.has(p.id))
        .map((p) => p.name),
    };
  }

  broadcast() {
    this.io.to(this.roomId).emit('room:state', this.publicState());
    this.io.to(adminChannel(this.roomId)).emit('admin:state', this.adminState());
  }

  broadcastAdmin() {
    this.io.to(adminChannel(this.roomId)).emit('admin:state', this.adminState());
  }
}

// ---- Manager: eine Runtime pro Raum, lazy erzeugt ------------------------
const runtimes = new Map();

export function getRuntime(roomId, io) {
  if (!getRoom(roomId)) return null;
  if (!runtimes.has(roomId)) runtimes.set(roomId, new RoomRuntime(roomId, io));
  return runtimes.get(roomId);
}

export function dropRuntime(roomId) {
  const rt = runtimes.get(roomId);
  if (rt) rt._clearTimeout();
  runtimes.delete(roomId);
}
