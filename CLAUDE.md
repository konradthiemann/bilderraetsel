# Bilderrätsel — Claude Code Projektanweisungen

## Zweck
Echtzeit-Bilderrätsel-Quiz (Kahoot-Style) für Feiern. Pro Frage wird ein Foto über exakt 60 s von stark verpixelt zu scharf — wer früher richtig tippt, bekommt mehr Punkte. Multi-Room, mobile-first, server-autoritatives Timing/Scoring.

## Tech-Stack
- **Backend:** Node.js ≥ 20 · Express 4 · Socket.io 4 (Echtzeit)
- **Frontend:** Vanilla JS · Tailwind CSS (CDN, **kein Build-Step** — bewusst, für maximale Portabilität)
- **Daten:** dateibasiert (`data/db.json` + `data/uploads/`), Passwort-Hashing via scrypt
- **Upload:** multer · **QR:** qrcode
- **Deploy:** Railway (Nixpacks), Node via `.nvmrc` (22.14.0), Start `npm start`, Healthcheck `/healthz`

## Befehle
```bash
npm install
npm run dev     # node --watch src/server.js (Auto-Reload)
npm start       # node src/server.js
npm run seed    # Standardspiel mit Dummy-Bildern anlegen
npm test        # node --test -> test/scoring.test.js
```
**Quality-Gate:** `npm test` grün + `node --check` auf allen JS-Dateien (siehe CI).

## Verzeichnisstruktur
```
src/
  server.js    # Express + Socket.io: REST-API & Event-Handler
  game.js      # Laufzeit-State-Machine pro Raum (Timer, Scoring)
  store.js     # JSON-Persistenz + Passwort-Hashing (scrypt)
  scoring.js   # Reine Punkte-/Leaderboard-Logik (unit-getestet)
public/        # index/play/beamer/admin.html + js/ + css/ (Vanilla JS)
scripts/seed.js
test/scoring.test.js
data/          # git-ignoriert, zur Laufzeit erzeugt (db.json + uploads/)
```

## Rollen
Admin (`ADMIN_PASSWORD`) · delegierter Host (Host-Token pro Raum) · Spieler (Raum-Passwort + Name) · Beamer (nur Raum-Code).

## Umgebungsvariablen
Siehe `.env.example`. Wichtig: `ADMIN_PASSWORD` (Default `admin` — **in Produktion setzen!**), `PORT` (Railway setzt es automatisch), `DATA_DIR` (Railway: aufs Volume zeigen), `PUBLIC_URL` (feste URL für QR-Codes), sowie die `SEED_*`-Vars für `npm run seed`.

## Konventionen
- Vanilla JS, ES Modules (`"type": "module"`), **kein Build-Step** — bewusst simpel halten
- Server-autoritatives Timing/Scoring (kein Client-Cheat möglich)
- Prosa/Kommentare Deutsch, Code-Bezeichner Englisch

## Do-Not-Modify (ohne triftigen Grund)
- **`src/scoring.js`** — Punkte-Formel `Math.round(100 * (1 - t/60))`, per Unit-Test abgesichert; Änderungen nur mit angepasstem Test
- **De-Blur-Animation** (`public/css/app.css`) — bewusst `@keyframes` (pausierbar + resync via negativem `animation-delay`), keine reine `transition`
- **`data/`** — Laufzeit-Daten, git-ignoriert

## Verbesserungsideen (offen, aus README)
- Tailwind-CDN → echter Tailwind-Build (Konsolen-Hinweis „not for production")
- Live-Punktestände optional ins Volume persistieren
- Bild-Optimierung (z. B. `sharp`) für sehr große Fotos
