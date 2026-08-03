# 🖼️ Bilderrätsel

Ein selbstgebautes, Echtzeit-Bilderrätsel-Quiz für Feiern – im Stil von Kahoot,
aber maßgeschneidert für den Eigenbetrieb.

**Spielprinzip:** Pro Frage wird ein Foto stark verpixelt/gezoomt gezeigt und
wird über **exakt 60 Sekunden** linear scharf. Wer früher richtig tippt, bekommt
mehr Punkte. Die Gäste raten auf ihren Handys, die Leinwand zeigt Bild, Countdown
und Rangliste.

- **Backend:** Node.js · Express · Socket.io (Echtzeit)
- **Frontend:** Vanilla JS · Tailwind CSS (CDN, kein Build-Step)
- **Daten:** dateibasiert (`db.json` + Bild-Uploads) → maximal portabel
- **Hosting:** Railway (Nixpacks, wie die Doewe-App)

---

## Inhaltsverzeichnis

- [Features](#features)
- [Projektstruktur](#projektstruktur)
- [Schnellstart (lokal)](#schnellstart-lokal)
- [Die drei Ansichten](#die-drei-ansichten)
- [Rollen & Passwörter](#rollen--passwörter)
- [Spiel- & Punkte-Logik](#spiel--punkte-logik)
- [Der De-Blur-Effekt](#der-de-blur-effekt)
- [Datenhaltung](#datenhaltung)
- [Environment-Variablen](#environment-variablen)
- [Deployment auf Railway](#deployment-auf-railway)
- [Eigene Domain](#eigene-domain)
- [Mehrere Feiern (Mandantenfähigkeit)](#mehrere-feiern-mandantenfähigkeit)
- [Tests](#tests)
- [Grenzen & Ideen](#grenzen--ideen)

---

## Features

- 🎛️ **Multi-Room** – beliebig viele getrennte Spiele (Räume), isoliert über
  Room-ID + Socket-Rooms + Raum-Passwort.
- 🎙️ **Gamemaster-Steuerung vom Handy** – Start, nächste Frage, Pause/Fortsetzen,
  Auflösen, Reset. Live-Anzeige „Wer hat noch nicht gedrückt?".
- 📺 **Beamer-Ansicht** – Warteraum mit QR-Code, großes De-Blur-Bild,
  Countdown-Ring, Antwortverteilung, Top-10-Rangliste.
- 📱 **Player-Ansicht** – strikt mobile-first, farbige Antwort-Buttons,
  persönliches Ergebnis + Rang.
- 🔒 **Server-autoritatives Timing & Scoring** – kein Client-Cheat möglich.
- 🔁 **Reconnect-sicher** – Handy gesperrt / Seite neu geladen? Spieler:innen
  landen automatisch wieder im Spiel (Session in `localStorage`).
- 🧩 **Fragen-Editor** mit Bild-Upload und 2–6 Antwortoptionen.

---

## Projektstruktur

```
Bilderrätsel/
├── package.json            # Dependencies + Scripts (start/dev/seed/test)
├── .nvmrc                  # Node 22.14.0 (wie Doewe)
├── railway.json            # Railway: Nixpacks + Startbefehl + Healthcheck
├── .env.example            # Vorlage für Environment-Variablen
│
├── src/
│   ├── server.js           # Express + Socket.io: REST-API & Event-Handler
│   ├── game.js             # Laufzeit-State-Machine pro Raum (Timer, Scoring)
│   ├── store.js            # JSON-Persistenz + Passwort-Hashing (scrypt)
│   └── scoring.js          # Reine Punkte-/Leaderboard-Logik (getestet)
│
├── public/
│   ├── index.html          # Landing (Rolle wählen / Code eingeben)
│   ├── play.html           # Player-View          + js/play.js
│   ├── beamer.html         # Spectator/Beamer-View + js/beamer.js
│   ├── admin.html          # Admin/Gamemaster-View + js/admin.js
│   ├── css/app.css         # De-Blur-Keyframes, Countdown-Ring, Party-Theme
│   └── js/common.js        # Geteilte Client-Helfer (Timer-Sync, Deblur, …)
│
├── scripts/
│   └── seed.js             # Standardspiel mit 20 Bildern anlegen
│
├── test/
│   └── scoring.test.js     # Unit-Tests der Punkte-Logik (node --test)
│
└── data/                   # (git-ignoriert, zur Laufzeit erzeugt)
    ├── db.json             # Räume + Fragen
    └── uploads/            # Hochgeladene/geseedete Bilder
```

---

## Schnellstart (lokal)

**Voraussetzung:** Node ≥ 20 (empfohlen 22, siehe `.nvmrc`).

```bash
# 1) Node-Version (falls nvm genutzt wird)
nvm use            # nutzt .nvmrc -> 22.14.0

# 2) Abhängigkeiten
npm install

# 3) Optional: Standardspiel mit 20 Dummy-Bildern anlegen.
#    Bilder nach ./seed-images legen ODER Ordner per Env angeben:
#    SEED_IMAGES_DIR="/pfad/zu/bildern" npm run seed
npm run seed

# 4) Starten
npm run dev        # mit Auto-Reload (node --watch)
#   oder
npm start
```

Danach:

| Ansicht | URL |
|---|---|
| Landing | <http://localhost:3000/> |
| Admin / Gamemaster | <http://localhost:3000/admin> |
| Beamer | `http://localhost:3000/beamer?room=<CODE>` |
| Spielen | `http://localhost:3000/play?room=<CODE>` |

> Das Admin-Passwort ist lokal per Default **`admin`** (siehe
> [Environment-Variablen](#environment-variablen)). Der Seed legt einen Raum mit
> Passwort **`party`** an und gibt den Raum-Code auf der Konsole aus.

### Typischer Ablauf auf der Feier

1. Am Laptop **`/admin`** öffnen, einloggen, Raum **„Hosten"**.
2. **Beamer öffnen** (Button im Host) und auf die Leinwand projizieren.
3. Gäste scannen den **QR-Code** → Passwort + Name → Warteraum.
4. Host drückt **„Spiel starten"** → Bild wird über 60 s scharf.
5. Nach jeder Frage: **„Nächste Frage"**. Zwischendurch **Pause** möglich.

---

## Die drei Ansichten

### 1. Admin / Gamemaster (`/admin`) — *mobile first*
Der Host moderiert alles vom Smartphone (während er das Mikro hält):
- **Dashboard:** Räume anlegen/löschen, Fragen bearbeiten, Beamer öffnen.
- **Fragen-Editor:** Fragetext, **Bild-Upload**, 2–6 Antworten mit
  Radio-Auswahl der richtigen Antwort.
- **Host-Steuerung:** Start · Nächste Frage · Pause/Fortsetzen · Auflösen · Reset.
  Live: **„Noch nicht geantwortet"** (Namen), Antwortverteilung, Top-5,
  und die **richtige Antwort** (nur für den Moderator sichtbar).

### 2. Beamer / Spectator (`/beamer?room=CODE`) — *Leinwand/Desktop*
- **Warteraum** mit großem QR-Code + Beitritts-URL + Liste der Gäste.
- **Frage:** großes De-Blur-Bild, Countdown-Ring, Antwortoptionen,
  „X / Y geantwortet".
- **Auflösung:** richtige Antwort grün + Verteilungs-Balken + **Top-10-Rangliste**.
- **Ende:** Endstand.

### 3. Player (`/play?room=CODE`) — *strictly mobile first*
- Beitritt: Passwort + eindeutiger Name (keine Registrierung).
- Farbige Antwort-Buttons; nach dem Tippen gesperrt (Spannung bleibt).
- Persönliches Ergebnis: richtig/falsch, Punkte, Rang.

---

## Rollen & Passwörter

| Rolle | Zugang | Kann… |
|---|---|---|
| **Admin (Master)** | `ADMIN_PASSWORD` (env) → Login unter `/admin` | Räume anlegen, Fragen verwalten, **jeden** Raum hosten |
| **Host (delegiert)** | Host-Link `/admin?room=CODE&host=<TOKEN>` | **nur diesen einen** Raum steuern – ohne Master-Passwort |
| **Gast/Spieler** | Raum-Passwort + Name | Mitspielen |
| **Zuschauer/Beamer** | nur Raum-Code | zuschauen |

> **Warum ein Host-Token?** So kannst du einer anderen Feiergesellschaft einen
> Link zum Steuern *ihres* Raums geben, ohne dein Master-Admin-Passwort zu teilen.
> Den `hostToken` findest du in der Admin-API (`GET /api/rooms`) bzw. in `db.json`.

**Sicherheit / Isolation:** Passwörter werden mit `scrypt` gehasht (kein
Klartext in `db.json`). Jeder Socket ist einem Raum zugeordnet; Kommandos wirken
ausschließlich auf den eigenen Raum. Die **richtige Antwort wird während einer
Frage nie** an Spieler/Beamer gesendet, sondern erst bei der Auflösung.

---

## Spiel- & Punkte-Logik

- **Antwortoptionen:** min. 2, max. 6 (Standardspiel: 4).
- **Zeitlimit:** exakt **60 Sekunden** pro Bild.
- **Lineare Punkte** (serverseitig gemessen, nur ganze Zahlen):

  ```js
  Punkte = Math.round(100 * (1 - vergangene_sekunden / 60))
  ```

  | Antwortzeit | Punkte |
  |---|---|
  | 0 s (sofort) | **100** |
  | 30 s | 50 |
  | 60 s | 0 |
  | falsch (egal wann) | 0 |

Die Logik liegt isoliert in [`src/scoring.js`](src/scoring.js) und ist per
Unit-Test abgesichert.

---

## Der De-Blur-Effekt

Umgesetzt als CSS-`@keyframes`-Animation (siehe [`public/css/app.css`](public/css/app.css)):

```css
@keyframes deblur {
  0%   { filter: blur(32px); transform: scale(1.6); }
  100% { filter: blur(0);    transform: scale(1);   }
}
```

Bewusst **nicht** als reine `transition`, weil eine Animation drei Dinge kann,
die wir brauchen:

1. **Pause/Fortsetzen** über `animation-play-state: paused` (Host-Pause).
2. **Resync** für spät dazugekommene Zuschauer/Reconnects über ein negatives
   `animation-delay: -<vergangene_zeit>ms` → das Bild springt an die korrekte
   Schärfe-Stufe.
3. Linearer 60-s-Verlauf, exakt an die serverseitige Uhr gekoppelt.

> Das reine Tailwind-Äquivalent wäre
> `class="transition-all duration-[60000ms] ease-linear blur-2xl scale-150 → blur-none scale-100"`
> – funktioniert visuell, lässt sich aber nicht sauber pausieren. Der Kommentar
> dazu steht im CSS.

---

## Datenhaltung

- **`data/db.json`** – Räume + Fragen (inkl. Passwort-Hash, `hostToken`).
- **`data/uploads/`** – hochgeladene bzw. geseedete Bilder.
- Der Speicherort ist über **`DATA_DIR`** konfigurierbar (Default `./data`).

> ⚠️ **Wichtig für Railway:** Der Container-Dateisystem ist **flüchtig** und wird
> bei jedem Deploy geleert. Damit Fragen & Bilder erhalten bleiben, muss ein
> **Volume** gemountet und `DATA_DIR` darauf gezeigt werden (siehe unten).

> Die **Punktestände** eines laufenden Spiels liegen im Arbeitsspeicher (bewusst,
> da pro Feier flüchtig). Ein Server-Neustart mitten im Spiel setzt die Punkte
> zurück – Fragen & Bilder bleiben (im Volume) erhalten.

---

## Environment-Variablen

| Variable | Default | Zweck |
|---|---|---|
| `ADMIN_PASSWORD` | `admin` | Passwort für den Admin-Bereich. **In Produktion setzen!** |
| `PORT` | `3000` | Port. Railway setzt das automatisch. |
| `DATA_DIR` | `./data` | Speicherort für `db.json` + Uploads. Auf Railway aufs Volume zeigen. |
| `PUBLIC_URL` | *(leer)* | Feste öffentliche URL für die QR-Codes. Leer = automatisch aus Request-Headern (funktioniert hinter dem Railway-Proxy). |
| `SEED_IMAGES_DIR` | `./seed-images` | Nur für `npm run seed`: Quellordner der Dummy-Bilder (auf beliebigen Bildordner setzbar). |
| `SEED_ROOM_PASSWORD` | `party` | Nur für `npm run seed`: Raum-Passwort des Standardspiels. |

Siehe [`.env.example`](.env.example).

---

## Deployment auf Railway

Wie die Doewe-App: **Nixpacks** (kein Dockerfile). Railway erkennt Node über
`.nvmrc`/`engines` und startet via `npm start`. [`railway.json`](railway.json)
legt Startbefehl + Healthcheck (`/healthz`) fest.

### Schritt für Schritt

1. **Projekt anlegen** und dieses Repo verbinden (GitHub) **oder** per CLI
   deployen:
   ```bash
   npm i -g @railway/cli
   railway login
   railway init
   railway up
   ```
2. **Volume anlegen** (für persistente Daten):
   - Im Service → *Volumes* → neues Volume, **Mount Path z. B. `/data`**.
3. **Variables setzen** (Service → *Variables*):
   ```
   ADMIN_PASSWORD = <dein-sicheres-passwort>
   DATA_DIR       = /data
   PUBLIC_URL     = https://bilderraetsel.konradthiemann.de   # optional, sobald Domain steht
   ```
   `PORT` **nicht** setzen – das macht Railway selbst.
4. **Deploy** abwarten, dann unter *Settings → Networking* eine
   **Public Domain** generieren und testen (`/healthz` muss `{"ok":true}` liefern).
5. **Standardspiel anlegen:** entweder im Admin-UI Fragen erstellen, **oder**
   einmalig seeden. Zum Seeden auf Railway ein eigenes Bilder-Set nutzen:
   ```bash
   railway run bash -lc 'SEED_IMAGES_DIR=/data/seed-bilder npm run seed'
   ```
   (Bilder vorher ins Volume legen.) Lokal genügt schlicht `npm run seed`.

---

## Eigene Domain

Geplant: **`bilderrätsel.konradthiemann.de`** (oder ASCII-Variante
`bilderraetsel.konradthiemann.de`).

- In Railway: *Service → Settings → Networking → Custom Domain* die Domain
  eintragen. Railway zeigt einen **CNAME**-Zielwert an.
- Beim DNS-Anbieter der Zone `konradthiemann.de` einen **CNAME**
  `bilderraetsel` → `<railway-ziel>` setzen.
- `PUBLIC_URL` in den Variables auf die finale URL setzen (damit die QR-Codes
  sicher die richtige Domain nutzen).

> **Umlaut-Hinweis:** `ä` in Domains läuft technisch über *Punycode*
> (`bilderrätsel` → `xn--bilderrtsel-r9a`). Das funktioniert, ist aber
> fehleranfälliger (Mail/Copy-Paste). Empfehlung: **`bilderraetsel`** verwenden.

---

## Mehrere Feiern (Mandantenfähigkeit)

Das System ist von Grund auf multi-room:

- Jeder Raum hat eigene **ID**, **Namen**, **Passwort** und **Fragen**.
- Im Admin einfach weitere Räume anlegen – fertig.
- Für eine fremde Feiergesellschaft, die selbst moderieren will: Raum anlegen,
  Fragen einpflegen, und ihr den **Host-Link**
  (`/admin?room=CODE&host=<TOKEN>`) + das Raum-Passwort geben. Sie steuern dann
  nur ihren Raum, ohne Zugriff auf deine anderen Spiele.

---

## Tests

```bash
npm test        # node --test  -> test/scoring.test.js
```

Deckt die Punkte-Formel (0 s/30 s/60 s, Rundung, falsche Antworten, Clamping)
und die Leaderboard-Sortierung ab.

---

## Grenzen & Ideen

- **Tailwind via CDN:** kein Build-Step (max. Portabilität). Die CDN-Variante
  zeigt in der Konsole einen „not for production"-Hinweis – für eine private
  Party-App unkritisch. Bei Bedarf später auf einen Tailwind-Build umstellen.
- **Punktestände flüchtig:** siehe [Datenhaltung](#datenhaltung). Bei Bedarf
  könnten Live-Scores ebenfalls ins Volume persistiert werden.
- **Bild-Optimierung:** aktuell werden Bilder unverändert ausgeliefert. Für sehr
  große Fotos wäre serverseitiges Resizing (z. B. `sharp`) eine Option.
```
