const { test } = require('node:test');
const assert = require('node:assert/strict');
const { categoryValue, averageFor } = require('../src/ratingValues');

test('categoryValue: новые поля читаются как есть', () => {
  const entry = { difficulty: 7, question: 9, process: 4 };
  assert.equal(categoryValue(entry, 'difficulty'), 7);
  assert.equal(categoryValue(entry, 'question'), 9);
  assert.equal(categoryValue(entry, 'process'), 4);
});

test('categoryValue: неоценённая категория — null', () => {
  assert.equal(categoryValue({}, 'difficulty'), null);
  assert.equal(categoryValue({ difficulty: 5 }, 'process'), null);
});

test('averageFor: среднее только по оценённым записям', () => {
  const entries = [
    { difficulty: 6 },
    { difficulty: 8 },
    { question: 10 },     // сложности нет — не учитывается
  ];
  assert.equal(averageFor(entries, 'difficulty'), 7);
  assert.equal(averageFor(entries, 'question'), 10);
  assert.equal(averageFor(entries, 'process'), null);
  assert.equal(averageFor([], 'difficulty'), null);
  assert.equal(averageFor(null, 'difficulty'), null);
});
