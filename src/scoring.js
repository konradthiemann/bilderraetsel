// src/scoring.js
// Reine, testbare Spiel-Logik: Punkteberechnung & Leaderboard.
// Bewusst ohne Seiteneffekte, damit einzeln testbar (siehe test/scoring.test.js).

export const QUESTION_DURATION_MS = 60_000; // exakt 60 Sekunden pro Bild

/**
 * Lineare Punkteberechnung laut Spezifikation.
 *   - Richtige Antwort bei  0 s  -> 100 Punkte
 *   - Richtige Antwort bei 60 s  ->   0 Punkte
 *   - Falsche Antwort            ->   0 Punkte (immer)
 *   - Es werden ausschließlich GANZE Zahlen vergeben (Math.round).
 *
 * Formel: Punkte = Math.round(100 * (1 - vergangene_sekunden / 60))
 *
 * @param {boolean} correct     War die Antwort richtig?
 * @param {number}  elapsedMs   Serverseitig gemessene vergangene Zeit in ms.
 * @param {number}  [durationMs] Gesamtdauer der Frage (Default 60 s).
 * @returns {number} Ganzzahlige Punkte im Bereich 0..100
 */
export function calculatePoints(correct, elapsedMs, durationMs = QUESTION_DURATION_MS) {
  if (!correct) return 0;
  const clampedMs = Math.min(durationMs, Math.max(0, Number(elapsedMs) || 0));
  const elapsedSeconds = clampedMs / 1000;
  const totalSeconds = durationMs / 1000;
  return Math.round(100 * (1 - elapsedSeconds / totalSeconds));
}

/**
 * Erzeugt das Leaderboard (absteigend nach Punkten, Gleichstand alphabetisch).
 * @param {Array<{id:string,name:string,score:number}>} players
 * @param {number} [limit=10]
 */
export function buildLeaderboard(players, limit = 10) {
  return [...players]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'de'))
    .slice(0, limit)
    .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: p.score }));
}
