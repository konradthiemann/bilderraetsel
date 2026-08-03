// test/scoring.test.js – node --test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculatePoints, buildLeaderboard } from '../src/scoring.js';

test('sofort richtig -> 100 Punkte', () => {
  assert.equal(calculatePoints(true, 0), 100);
});

test('bei 60s richtig -> 0 Punkte', () => {
  assert.equal(calculatePoints(true, 60_000), 0);
});

test('bei 30s richtig -> 50 Punkte (linear)', () => {
  assert.equal(calculatePoints(true, 30_000), 50);
});

test('immer ganze Zahlen (Math.round)', () => {
  const p = calculatePoints(true, 20_123);
  assert.ok(Number.isInteger(p));
  assert.equal(p, Math.round(100 * (1 - 20_123 / 60_000)));
});

test('falsche Antwort -> 0 Punkte, egal wann', () => {
  assert.equal(calculatePoints(false, 0), 0);
  assert.equal(calculatePoints(false, 15_000), 0);
});

test('clamping: negativ/über Dauer', () => {
  assert.equal(calculatePoints(true, -500), 100);
  assert.equal(calculatePoints(true, 999_999), 0);
});

test('Leaderboard sortiert absteigend, Top-N, mit Rang', () => {
  const players = [
    { id: 'a', name: 'Anna', score: 30 },
    { id: 'b', name: 'Bert', score: 90 },
    { id: 'c', name: 'Cora', score: 90 },
  ];
  const lb = buildLeaderboard(players, 2);
  assert.equal(lb.length, 2);
  assert.equal(lb[0].name, 'Bert'); // Gleichstand -> alphabetisch
  assert.equal(lb[0].rank, 1);
  assert.equal(lb[1].name, 'Cora');
});
