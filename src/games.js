const GameState = require('./gameState');

// Хранилище игр по чатам
const games = new Map();

function getGame(chatId) {
  if (!games.has(chatId)) {
    games.set(chatId, new GameState());
  }
  return games.get(chatId);
}

module.exports = { getGame };
