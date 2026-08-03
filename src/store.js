// src/store.js
// Dateibasierte Persistenz (JSON) für Räume, Fragen & Passwörter.
// Bewusst simpel gehalten -> maximale Portabilität (kein DB-Server nötig).
//
// Persistiert werden nur die "statischen" Spieldaten (Name, Passwort-Hash,
// Fragen, Bild-URLs). Der flüchtige Spielzustand (Punkte, Timer, wer online
// ist) lebt im Arbeitsspeicher (siehe game.js).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const paths = { DATA_DIR, UPLOADS_DIR, DB_FILE };

let db = { rooms: [] };

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = parsed && Array.isArray(parsed.rooms) ? parsed : { rooms: [] };
    }
  } catch (err) {
    console.error('[store] db.json konnte nicht gelesen werden – starte leer:', err.message);
    db = { rooms: [] };
  }
}

// Debounced write, damit Bursts (z.B. viele Fragen-Uploads) nicht die Platte fluten.
let saveTimer = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
      console.error('[store] Speichern fehlgeschlagen:', err.message);
    }
  }, 50);
}

/** Sofort & synchron speichern (z.B. am Ende von Skripten wie seed.js). */
export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

load();

// ---- IDs & Tokens --------------------------------------------------------
// Alphabet ohne leicht verwechselbare Zeichen (0/O, 1/I/L) – gut für Raumcodes.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function shortId(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ---- Passwörter (scrypt, ohne externe Dependency) ------------------------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password ?? ''), salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(password ?? ''), salt, expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// ---- Räume ---------------------------------------------------------------
export function listRooms() {
  return db.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    questionCount: r.questions.length,
    createdAt: r.createdAt,
    hostToken: r.hostToken,
  }));
}

export function getRoom(id) {
  return db.rooms.find((r) => r.id === id) || null;
}

function uniqueRoomId() {
  let id;
  do {
    id = shortId(5);
  } while (getRoom(id));
  return id;
}

export function createRoom({ name, password, answerOptionsDefault = 4 }) {
  const room = {
    id: uniqueRoomId(),
    name: String(name || 'Neues Spiel').trim().slice(0, 80) || 'Neues Spiel',
    passwordHash: hashPassword(password),
    hostToken: token(18),
    answerOptionsDefault: clampOptions(answerOptionsDefault, 4),
    questions: [],
    createdAt: Date.now(),
  };
  db.rooms.push(room);
  persist();
  return room;
}

export function updateRoom(id, patch = {}) {
  const room = getRoom(id);
  if (!room) return null;
  if (typeof patch.name === 'string') room.name = patch.name.trim().slice(0, 80) || room.name;
  if (patch.password) room.passwordHash = hashPassword(patch.password);
  if (patch.answerOptionsDefault != null) {
    room.answerOptionsDefault = clampOptions(patch.answerOptionsDefault, room.answerOptionsDefault);
  }
  persist();
  return room;
}

export function deleteRoom(id) {
  const i = db.rooms.findIndex((r) => r.id === id);
  if (i === -1) return false;
  db.rooms.splice(i, 1);
  persist();
  return true;
}

function clampOptions(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(6, Math.max(2, Math.round(v)));
}

// ---- Fragen --------------------------------------------------------------
/**
 * Validiert & normalisiert eine Frage.
 * Erwartet: { text, imageUrl, options:[{id?,text}|string], correctOptionId|correctIndex }
 * Wirft Error bei ungültigen Daten (2..6 Optionen, genau eine korrekte).
 */
export function normalizeQuestion(input) {
  const text = String(input.text || '').trim();

  let options = Array.isArray(input.options) ? input.options : [];
  options = options
    .map((o) => (typeof o === 'string' ? { text: o } : o || {}))
    .map((o) => ({ id: o.id || shortId(4), text: String(o.text || '').trim() }))
    .filter((o) => o.text.length > 0)
    .slice(0, 6);

  if (options.length < 2) throw new Error('Mindestens 2 Antwortmöglichkeiten nötig.');
  if (options.length > 6) throw new Error('Maximal 6 Antwortmöglichkeiten erlaubt.');

  let correctOptionId = input.correctOptionId;
  if (!correctOptionId && Number.isInteger(input.correctIndex)) {
    correctOptionId = options[input.correctIndex]?.id;
  }
  if (!correctOptionId || !options.some((o) => o.id === correctOptionId)) {
    throw new Error('Es muss genau eine korrekte Antwort markiert sein.');
  }

  return {
    text,
    imageUrl: String(input.imageUrl || ''),
    options,
    correctOptionId,
  };
}

export function addQuestion(roomId, input) {
  const room = getRoom(roomId);
  if (!room) return null;
  const q = normalizeQuestion(input);
  q.id = shortId(8);
  room.questions.push(q);
  persist();
  return q;
}

export function updateQuestion(roomId, qid, input) {
  const room = getRoom(roomId);
  if (!room) return null;
  const idx = room.questions.findIndex((q) => q.id === qid);
  if (idx === -1) return null;
  const merged = normalizeQuestion({ ...room.questions[idx], ...input });
  merged.id = qid;
  room.questions[idx] = merged;
  persist();
  return merged;
}

export function deleteQuestion(roomId, qid) {
  const room = getRoom(roomId);
  if (!room) return false;
  const idx = room.questions.findIndex((q) => q.id === qid);
  if (idx === -1) return false;
  room.questions.splice(idx, 1);
  persist();
  return true;
}

export function reorderQuestions(roomId, order) {
  const room = getRoom(roomId);
  if (!room || !Array.isArray(order)) return false;
  const map = new Map(room.questions.map((q) => [q.id, q]));
  const next = order.map((id) => map.get(id)).filter(Boolean);
  for (const q of room.questions) if (!order.includes(q.id)) next.push(q); // Sicherheitsnetz
  room.questions = next;
  persist();
  return true;
}
