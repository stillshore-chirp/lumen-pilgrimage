import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { LAKE_KOTO_DURATION, LAKE_KOTO_SAMPLE_RATE, LAKE_KOTO_TUNING, LAKE_KOTO_EVENTS,
  KOTO_STUDY_CASES, renderKotoPerformance, renderKotoStudyCase } from '../src/coast/world/lake/kotoPerformance.ts';

test('the independent 39-second piece preserves all 48 original note events and thirteen-string tuning', async () => {
  const legacy = await readFile(new URL('./fixtures/lakeKotoLegacy.ts', import.meta.url), 'utf8');
  const score = legacy.match(/const SCORE:[\s\S]*?= \[([\s\S]*?)\n\];/)[1];
  const events = [...score.matchAll(/\[(\d+(?:\.\d+)?),\s*(\d+),\s*(\d+(?:\.\d+)?)(?:,\s*([12]))?\]/g)]
    .map(([, seconds, string, force, press]) => [Number(seconds), Number(string), Number(force), press ? Number(press) : undefined]);
  assert.equal(events.length, 48);
  assert.deepEqual(LAKE_KOTO_EVENTS.map(event => [event.seconds, event.string, event.force, event.pressSemitones]), events);
  assert.equal(LAKE_KOTO_DURATION, 39);
  assert.equal(LAKE_KOTO_SAMPLE_RATE, 48000);
  assert.equal(LAKE_KOTO_TUNING.length, 13);
  assert.equal(LAKE_KOTO_TUNING[0].frequency, LAKE_KOTO_TUNING[4].frequency);
  assert.equal(LAKE_KOTO_TUNING[12].frequency, 880);
});

test('shared performance inputs allow left-hand changes and end with explicit damping', () => {
  const calls = [];
  const samples = renderKotoPerformance(note => { calls.push(note); return Float32Array.of(note.velocity); });
  assert.equal(samples.length, 39 * 48000);
  const pressed = LAKE_KOTO_EVENTS.filter(event => event.pressSemitones);
  for (let i = 0; i < pressed.length - 1; i += 1) {
    assert.ok(pressed[i].seconds + pressed[i].dampAt < pressed[i + 1].seconds);
  }
  assert.equal(calls.length, 48);
  assert.ok(calls.every(note => note.duration > 0 && note.duration <= 8 && note.dampAt > 0));
  assert.ok(calls.at(-1).dampAt < calls.at(-1).duration);
  assert.ok(samples.subarray(0, 0.08 * 48000).every(value => value === 0));
});

test('comparison inputs distinguish a simultaneous chord from successive overlapping notes', () => {
  assert.equal(KOTO_STUDY_CASES.length, 16);
  const renderer = note => Float32Array.of(note.velocity);
  const chord = renderKotoStudyCase('chord', renderer);
  const overlap = renderKotoStudyCase('overlap', renderer);
  assert.ok(Math.abs(chord[0] - 1.2) < 1e-6);
  assert.ok(Math.abs(overlap[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(overlap[Math.round(0.16 * 48000)] - 0.5) < 1e-6);
  assert.throws(() => renderKotoStudyCase('missing', renderer), /Unknown/);
  assert.throws(() => renderKotoPerformance(renderer, 24000), /sample rate/);
});
