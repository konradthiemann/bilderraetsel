// scripts/seed.js
// Legt ein Standardspiel mit 20 Fragen an und kopiert 20 Dummy-Bilder aus
// einem lokalen Ordner (Default: dein Screenshots-Ordner) in data/uploads/.
//
// Nutzung:   npm run seed
// Konfig:    SEED_IMAGES_DIR, SEED_ROOM_NAME, SEED_ROOM_PASSWORD, SEED_COUNT
//
// Danach im Admin (/admin) die Fragetexte & Antworten anpassen – die Bilder
// sind bereits verknüpft.

import fs from 'node:fs';
import path from 'node:path';
import { paths, createRoom, addQuestion, flush, shortId } from '../src/store.js';

// Quelle der Dummy-Bilder: per SEED_IMAGES_DIR überschreibbar,
// sonst der repo-lokale Ordner ./seed-images (git-ignoriert).
const SRC = process.env.SEED_IMAGES_DIR || path.join(process.cwd(), 'seed-images');
const ROOM_NAME = process.env.SEED_ROOM_NAME || 'Standardspiel';
const ROOM_PASSWORD = process.env.SEED_ROOM_PASSWORD || 'party';
const COUNT = Number(process.env.SEED_COUNT || 20);
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

function pickImages() {
  if (!fs.existsSync(SRC)) {
    console.error(`\n❌ Bildordner nicht gefunden:\n   ${SRC}\n`);
    console.error('   Setze SEED_IMAGES_DIR auf einen existierenden Ordner und versuche es erneut.\n');
    process.exit(1);
  }
  const files = fs
    .readdirSync(SRC)
    .filter((f) => IMG_RE.test(f))
    .sort();
  if (files.length === 0) {
    console.error(`\n❌ Keine Bilddateien in ${SRC} gefunden.\n`);
    process.exit(1);
  }
  return files.slice(0, COUNT);
}

function copyImage(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const target = `${Date.now()}-${shortId(6)}${ext}`;
  fs.copyFileSync(path.join(SRC, fileName), path.join(paths.UPLOADS_DIR, target));
  return `/uploads/${target}`;
}

function main() {
  const images = pickImages();
  const room = createRoom({ name: ROOM_NAME, password: ROOM_PASSWORD, answerOptionsDefault: 4 });

  images.forEach((file, i) => {
    const imageUrl = copyImage(file);
    addQuestion(room.id, {
      text: `Bild ${i + 1}: Worum geht es hier?`,
      imageUrl,
      options: [
        { text: 'Antwort A (bitte anpassen)' },
        { text: 'Antwort B' },
        { text: 'Antwort C' },
        { text: 'Antwort D' },
      ],
      correctIndex: 0,
    });
  });

  flush();

  console.log('\n✅ Seed abgeschlossen!');
  console.log(`   Spiel:     ${ROOM_NAME}`);
  console.log(`   Raum-Code: ${room.id}`);
  console.log(`   Passwort:  ${ROOM_PASSWORD}`);
  console.log(`   Fragen:    ${images.length} (Bilder verknüpft)`);
  console.log(`\n   Beamer:  /beamer?room=${room.id}`);
  console.log(`   Spielen: /play?room=${room.id}`);
  console.log('\n   ➜ Im Admin (/admin) jetzt Fragetexte & Antworten anpassen.\n');
}

main();
