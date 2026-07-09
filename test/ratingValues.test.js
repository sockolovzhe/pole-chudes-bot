const { test } = require('node:test');
const assert = require('node:assert/strict');
const { categoryValue, averageFor } = require('../src/ratingValues');

test('categoryValue: новые поля читаются как есть', () => {
  const entry = { difficulty: 7, question: 9, process: 4 };
  assert.equal(categoryValue(entry, 'difficulty'), 7);
  assert.equal(categoryValue(entry, 'question'), 9);
  assert.equal(categoryValue(entry, 'process'), 4);
});

test('categoryValue: старая оценка 1-5 считается сложностью ×2', () => {
  assert.equal(categoryValue({ rating: 3 }, 'difficulty'), 6);
  assert.equal(categoryValue({ rating: 5 }, 'difficulty'), 10);
  // Старая оценка не влияет на другие категории
  assert.equal(categoryValue({ rating: 3 }, 'question'), null);
  // Новое поле имеет приоритет над старым
  assert.equal(categoryValue({ rating: 3, difficulty: 9 }, 'difficulty'), 9);
});

test('categoryValue: неоценённая категория — null', () => {
  assert.equal(categoryValue({}, 'difficulty'), null);
  assert.equal(categoryValue({ difficulty: 5 }, 'process'), null);
});

test('averageFor: среднее по смеси старых и новых оценок', () => {
  const entries = [
    { rating: 3 },        // старая шкала -> 6
    { difficulty: 8 },
    { question: 10 },     // сложности нет — не учитывается
  ];
  assert.equal(averageFor(entries, 'difficulty'), 7);
  assert.equal(averageFor(entries, 'question'), 10);
  assert.equal(averageFor(entries, 'process'), null);
  assert.equal(averageFor([], 'difficulty'), null);
  assert.equal(averageFor(null, 'difficulty'), null);
});
