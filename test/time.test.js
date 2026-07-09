const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatTime, formatClock, formatDateTime, isSameEkbDay, parseScheduleTime } = require('../src/time');

// Опорный момент: 2026-07-09 12:00 UTC = 17:00 по Екатеринбургу (UTC+5)
const NOW = new Date('2026-07-09T12:00:00Z');

test('formatTime/formatClock/formatDateTime показывают время по Екатеринбургу', () => {
  assert.equal(formatTime(NOW), '17:00:00');
  assert.equal(formatClock(NOW), '17:00');
  assert.equal(formatDateTime(new Date('2026-07-08T23:30:00Z')), '09.07.2026 04:30');
});

test('isSameEkbDay сравнивает календарные дни по Екатеринбургу', () => {
  // 20:00 UTC = 01:00 следующего дня по Екб
  assert.equal(isSameEkbDay(new Date('2026-07-09T18:00:00Z'), NOW), true);
  assert.equal(isSameEkbDay(new Date('2026-07-09T20:00:00Z'), NOW), false);
});

test('parseScheduleTime: время впереди — сегодня', () => {
  const target = parseScheduleTime('18:30', NOW);
  assert.equal(target.toISOString(), '2026-07-09T13:30:00.000Z');
});

test('parseScheduleTime: время уже прошло — завтра', () => {
  const target = parseScheduleTime('09:15', NOW);
  assert.equal(target.toISOString(), '2026-07-10T04:15:00.000Z');
});

test('parseScheduleTime: ровно текущая минута — завтра', () => {
  const target = parseScheduleTime('17:00', NOW);
  assert.equal(target.toISOString(), '2026-07-10T12:00:00.000Z');
});

test('parseScheduleTime принимает разные разделители и час без нуля', () => {
  assert.ok(parseScheduleTime('9:05', NOW));
  assert.ok(parseScheduleTime('18.45', NOW));
  assert.ok(parseScheduleTime('18 45', NOW));
});

test('parseScheduleTime отклоняет мусор', () => {
  for (const bad of ['привет', '25:00', '18:5', '18:60', '', '  ', null, undefined]) {
    assert.equal(parseScheduleTime(bad, NOW), null, `должно отклонить: ${bad}`);
  }
});
