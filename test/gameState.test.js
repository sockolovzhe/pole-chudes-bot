const { test } = require('node:test');
const assert = require('node:assert/strict');
const GameState = require('../src/gameState');

function newGame(word = 'ПРИМЕР') {
  const game = new GameState();
  game.hostId = 1;
  game.setWord(word);
  game.addPlayer(10, 'anna');
  game.addPlayer(20, 'boris');
  return game;
}

test('setWord запускает игру и сбрасывает раунд', () => {
  const game = newGame();
  assert.equal(game.isActive, true);
  assert.equal(game.currentPlayerIndex, -1);
  assert.equal(game.getDisplayWord().includes('█'), true);
});

test('ведущий не добавляется в игроки', () => {
  const game = newGame();
  game.addPlayer(1, 'host');
  assert.equal(game.players.length, 2);
});

test('guessLetter: буква есть — очки кратны 100 с учётом вхождений', () => {
  const game = newGame('ПРИМЕР');
  const result = game.guessLetter('Р', 10);
  assert.equal(result.success, true);
  assert.equal(result.letterCount, 2);
  assert.equal(result.points % 100, 0);
  assert.equal(result.points, result.basePoints * 2);
  assert.equal(game.getPlayerScore(10), result.points);
});

test('guessLetter: буквы нет / повторная попытка', () => {
  const game = newGame();
  const miss = game.guessLetter('Ю', 10);
  assert.equal(miss.success, false);
  assert.equal(miss.alreadyTried, false);

  const repeat = game.guessLetter('Ю', 20);
  assert.equal(repeat.alreadyTried, true);
});

test('нормализация букв: Й равна И, Ё равна Е', () => {
  const game = newGame('ЙОД');
  assert.equal(game.guessLetter('И', 10).success, true);
  const game2 = newGame('ЁЛКА');
  assert.equal(game2.guessLetter('Е', 10).success, true);
});

test('guessWord: верное слово открывает все буквы и даёт бонус 1/3', () => {
  const game = newGame('ТЕСТ');
  const result = game.guessWord('тест', 10);
  assert.equal(result.success, true);
  assert.equal(result.bonus, Math.floor(result.basePoints / 3));
  assert.equal(game.isComplete(), true);
});

test('guessWord: тире и пробел взаимозаменяемы', () => {
  const game = newGame('САНКТ-ПЕТЕРБУРГ');
  assert.equal(game.checkWord('САНКТ ПЕТЕРБУРГ'), true);
});

test('очередь ходов: передача и выбывание', () => {
  const game = newGame();
  assert.equal(game.passTurnToNext().id, 10);
  assert.equal(game.passTurnToNext().id, 20);
  assert.equal(game.passTurnToNext().id, 10);

  game.excludePlayerFromTurns(10);
  assert.equal(game.getCurrentPlayer().id, 20);
  assert.equal(game.getActivePlayers().length, 1);
});

test('reset очищает раунд, отклонённые слова и флаг объявления', () => {
  const game = newGame();
  game.rejectedWords.push('СЛОВО');
  game.firstTurnAnnounced = true;
  game.reset();
  assert.equal(game.word, '');
  assert.equal(game.isActive, false);
  assert.deepEqual(game.rejectedWords, []);
  assert.equal(game.firstTurnAnnounced, false);
  // Игроки и ведущий переживают reset
  assert.equal(game.players.length, 2);
  assert.equal(game.hostId, 1);
});

test('reset и setWord отменяют отложенный старт', () => {
  const game = new GameState();
  let fired = false;
  game.scheduledStart = { riddle: {}, startAt: new Date(), timer: setTimeout(() => { fired = true; }, 20) };
  game.reset();
  assert.equal(game.scheduledStart, null);

  game.scheduledStart = { riddle: {}, startAt: new Date(), timer: setTimeout(() => { fired = true; }, 20) };
  game.setWord('НОВОЕ');
  assert.equal(game.scheduledStart, null);

  return new Promise(resolve => setTimeout(() => {
    assert.equal(fired, false, 'отменённые таймеры не должны сработать');
    resolve();
  }, 50));
});

test('getWrongLetters возвращает только промахи', () => {
  const game = newGame('ПРИМЕР');
  game.guessLetter('П', 10);
  game.guessLetter('Ю', 10);
  game.guessLetter('Я', 20);
  assert.deepEqual(game.getWrongLetters(), ['Ю', 'Я']);
});
