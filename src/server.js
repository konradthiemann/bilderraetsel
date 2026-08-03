// src/server.js
// Express + Socket.io Bootstrap: statische Views, REST-API (Admin/Fragen/Upload/QR)
// und die Echtzeit-Event-Handler (joinRoom, submitAnswer, Gamemaster-Kommandos).

import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { Server as SocketServer } from 'socket.io';

import {
  paths,
  token,
  shortId,
  verifyPassword,
  listRooms,
  getRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  addQuestion,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
} from './store.js';
import { getRuntime, dropRuntime, adminChannel } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

if (ADMIN_PASSWORD === 'admin') {
  console.warn('\n⚠️  ADMIN_PASSWORD ist nicht gesetzt – nutze Default "admin". In Produktion setzen!\n');
}

const app = express();
app.set('trust proxy', true); // korrekte Protokoll-/Host-Erkennung hinter Railway-Proxy
app.use(express.json({ limit: '1mb' }));

const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: true } });

// ---- Admin-Session (In-Memory-Keys mit Ablauf) ---------------------------
const adminKeys = new Map(); // key -> expiresAt
const ADMIN_KEY_TTL = 1000 * 60 * 60 * 12; // 12 h

function issueAdminKey() {
  const key = token(24);
  adminKeys.set(key, Date.now() + ADMIN_KEY_TTL);
  return key;
}
function validAdminKey(key) {
  const exp = adminKeys.get(key);
  if (!exp) return false;
  if (exp < Date.now()) {
    adminKeys.delete(key);
    return false;
  }
  return true;
}
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : req.query.key || '';
  if (!validAdminKey(key)) return res.status(401).json({ error: 'Nicht autorisiert.' });
  next();
}

// ---- Uploads (multer) ----------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, paths.UPLOADS_DIR),
    filename: (req, file, cb) => {
      const raw = path.extname(file.originalname || '').toLowerCase();
      const ext = /^\.[a-z0-9]{1,5}$/.test(raw) ? raw : '.png';
      cb(null, `${Date.now()}-${shortId(6)}${ext}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12 MB
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// =========================================================================
//  REST-API
// =========================================================================

app.get('/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// -- Admin-Login -----------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (String(password ?? '') !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Falsches Admin-Passwort.' });
  }
  res.json({ ok: true, adminKey: issueAdminKey() });
});

// -- Räume (Admin) ---------------------------------------------------------
app.get('/api/rooms', requireAdmin, (req, res) => {
  res.json({ rooms: listRooms() });
});

app.post('/api/rooms', requireAdmin, (req, res) => {
  const { name, password, answerOptionsDefault } = req.body || {};
  if (!password || String(password).length < 1) {
    return res.status(400).json({ error: 'Bitte ein Raum-Passwort vergeben.' });
  }
  const room = createRoom({ name, password, answerOptionsDefault });
  res.json({ ok: true, room: adminRoomView(room) });
});

app.get('/api/rooms/:id', requireAdmin, (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Raum nicht gefunden.' });
  res.json({ room: adminRoomView(room) });
});

app.patch('/api/rooms/:id', requireAdmin, (req, res) => {
  const room = updateRoom(req.params.id, req.body || {});
  if (!room) return res.status(404).json({ error: 'Raum nicht gefunden.' });
  res.json({ ok: true, room: adminRoomView(room) });
});

app.delete('/api/rooms/:id', requireAdmin, (req, res) => {
  const ok = deleteRoom(req.params.id);
  if (ok) dropRuntime(req.params.id);
  res.json({ ok });
});

// -- Fragen (Admin) --------------------------------------------------------
app.post('/api/rooms/:id/questions', requireAdmin, (req, res) => {
  try {
    const q = addQuestion(req.params.id, req.body || {});
    if (!q) return res.status(404).json({ error: 'Raum nicht gefunden.' });
    res.json({ ok: true, question: q });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/rooms/:id/questions/:qid', requireAdmin, (req, res) => {
  try {
    const q = updateQuestion(req.params.id, req.params.qid, req.body || {});
    if (!q) return res.status(404).json({ error: 'Frage nicht gefunden.' });
    res.json({ ok: true, question: q });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/rooms/:id/questions/:qid', requireAdmin, (req, res) => {
  const ok = deleteQuestion(req.params.id, req.params.qid);
  res.json({ ok });
});

app.post('/api/rooms/:id/questions/reorder', requireAdmin, (req, res) => {
  const ok = reorderQuestions(req.params.id, req.body?.order || []);
  res.json({ ok });
});

// -- Bild-Upload (Admin) ---------------------------------------------------
app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Bilddatei erhalten.' });
  res.json({ ok: true, imageUrl: `/uploads/${req.file.filename}` });
});

// -- Öffentlich: Raum-Existenz (für Player-Beitritt) -----------------------
app.get('/api/rooms/:id/public', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Raum nicht gefunden.' });
  res.json({ id: room.id, name: room.name });
});

// -- Öffentlich: QR-Code + Beitritts-URL (für den Beamer) ------------------
app.get('/api/rooms/:id/qr', async (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Raum nicht gefunden.' });
  const joinUrl = buildJoinUrl(req, room.id);
  try {
    const dataUrl = await QRCode.toDataURL(joinUrl, {
      width: 640,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.json({ joinUrl, dataUrl, roomName: room.name });
  } catch (err) {
    res.status(500).json({ error: 'QR-Erzeugung fehlgeschlagen.' });
  }
});

function buildJoinUrl(req, roomId) {
  if (process.env.PUBLIC_URL) {
    return `${process.env.PUBLIC_URL.replace(/\/$/, '')}/play?room=${roomId}`;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/play?room=${roomId}`;
}

/** Admin-Ansicht eines Raums: inkl. richtiger Antworten + hostToken, ohne Passwort-Hash. */
function adminRoomView(room) {
  return {
    id: room.id,
    name: room.name,
    hostToken: room.hostToken,
    answerOptionsDefault: room.answerOptionsDefault,
    questionCount: room.questions.length,
    questions: room.questions,
    createdAt: room.createdAt,
  };
}

// ---- Statische Views -----------------------------------------------------
app.use('/uploads', express.static(paths.UPLOADS_DIR, { maxAge: '7d' }));
app.use(express.static(PUBLIC_DIR));

const page = (file) => (req, res) => res.sendFile(path.join(PUBLIC_DIR, file));
app.get('/', page('index.html'));
app.get('/play', page('play.html'));
app.get('/beamer', page('beamer.html'));
app.get('/admin', page('admin.html'));

// =========================================================================
//  Socket.io – Echtzeit
// =========================================================================

io.on('connection', (socket) => {
  socket.data = { role: null, roomId: null, playerId: null };

  // -- Spieler tritt bei ---------------------------------------------------
  socket.on('player:join', ({ roomId, password, username } = {}, cb = () => {}) => {
    const room = getRoom(roomId);
    if (!room) return cb({ ok: false, error: 'Raum nicht gefunden.' });
    if (!verifyPassword(password, room.passwordHash)) {
      return cb({ ok: false, error: 'Falsches Passwort.' });
    }
    const name = String(username || '').trim().slice(0, 24);
    if (!name) return cb({ ok: false, error: 'Bitte einen Namen eingeben.' });

    const rt = getRuntime(roomId, io);
    if (rt.nameTaken(name)) return cb({ ok: false, error: 'Dieser Name ist schon vergeben.' });

    const player = rt.addPlayer(name, socket.id);
    socket.data = { role: 'player', roomId, playerId: player.id };
    socket.join(roomId);
    cb({ ok: true, playerId: player.id, token: player.token, state: rt.publicState() });
    rt.broadcast();
  });

  // -- Spieler kommt zurück (Reload / Reconnect) ---------------------------
  socket.on('player:resume', ({ roomId, playerId, token: tok } = {}, cb = () => {}) => {
    const room = getRoom(roomId);
    if (!room) return cb({ ok: false, error: 'Raum nicht gefunden.' });
    const rt = getRuntime(roomId, io);
    const player = rt.resumePlayer(playerId, tok, socket.id);
    if (!player) return cb({ ok: false, error: 'Sitzung ungültig.' });
    socket.data = { role: 'player', roomId, playerId };
    socket.join(roomId);
    const answer = rt.answers.get(playerId);
    cb({
      ok: true,
      playerId,
      name: player.name,
      state: rt.publicState(),
      alreadyAnswered: !!answer,
      yourOptionId: answer ? answer.optionId : null,
    });
    rt.broadcast();
  });

  // -- Antwort abgeben -----------------------------------------------------
  socket.on('player:answer', ({ optionId } = {}, cb = () => {}) => {
    const { roomId, playerId } = socket.data;
    if (!roomId || !playerId) return cb({ ok: false, error: 'Nicht im Spiel.' });
    const rt = getRuntime(roomId, io);
    if (!rt) return cb({ ok: false, error: 'Raum weg.' });
    cb(rt.submitAnswer(playerId, optionId));
  });

  // -- Zuschauer / Beamer --------------------------------------------------
  socket.on('spectator:join', ({ roomId } = {}, cb = () => {}) => {
    const room = getRoom(roomId);
    if (!room) return cb({ ok: false, error: 'Raum nicht gefunden.' });
    const rt = getRuntime(roomId, io);
    socket.data = { role: 'spectator', roomId };
    socket.join(roomId);
    cb({ ok: true, state: rt.publicState() });
  });

  // -- Gamemaster meldet sich an (Admin-Key ODER Host-Token) ---------------
  socket.on('admin:host', ({ roomId, adminKey, hostToken } = {}, cb = () => {}) => {
    const room = getRoom(roomId);
    if (!room) return cb({ ok: false, error: 'Raum nicht gefunden.' });
    const authorized = validAdminKey(adminKey) || (hostToken && hostToken === room.hostToken);
    if (!authorized) return cb({ ok: false, error: 'Nicht autorisiert für diesen Raum.' });

    // Beim Wechsel des gehosteten Raums die alten Kanäle verlassen.
    if (socket.data.role === 'admin' && socket.data.roomId && socket.data.roomId !== roomId) {
      socket.leave(socket.data.roomId);
      socket.leave(adminChannel(socket.data.roomId));
    }

    const rt = getRuntime(roomId, io);
    socket.data = { role: 'admin', roomId };
    socket.join(roomId);
    socket.join(adminChannel(roomId));
    cb({
      ok: true,
      state: rt.adminState(),
      room: adminRoomView(room),
    });
  });

  // -- Gamemaster-Kommandos ------------------------------------------------
  socket.on('admin:command', ({ action } = {}, cb = () => {}) => {
    const { role, roomId } = socket.data;
    if (role !== 'admin' || !roomId) return cb({ ok: false, error: 'Nicht als Host angemeldet.' });
    const rt = getRuntime(roomId, io);
    if (!rt) return cb({ ok: false, error: 'Raum weg.' });

    let result;
    switch (action) {
      case 'start': result = rt.startGame(); break;
      case 'next': result = rt.nextQuestion(); break;
      case 'pause': result = rt.pause(); break;
      case 'resume': result = rt.resume(); break;
      case 'reveal': result = rt.endQuestion(); break;
      case 'reset': result = rt.resetGame(); break;
      default: result = { ok: false, error: 'Unbekannte Aktion.' };
    }
    cb(result);
  });

  socket.on('disconnect', () => {
    const { role, roomId, playerId } = socket.data;
    if (role === 'player' && roomId && playerId) {
      const rt = getRuntime(roomId, io);
      if (rt) {
        rt.setConnected(playerId, false);
        rt.broadcast();
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🎉 Bilderrätsel läuft auf http://localhost:${PORT}`);
  console.log(`   Daten-Verzeichnis: ${paths.DATA_DIR}`);
  console.log(`   Admin:   http://localhost:${PORT}/admin`);
  console.log(`   Beamer:  http://localhost:${PORT}/beamer?room=<CODE>`);
  console.log(`   Spielen: http://localhost:${PORT}/play?room=<CODE>\n`);
});
