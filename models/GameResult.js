const mongoose = require('mongoose');

// Схема для результата одной игры
const gameResultSchema = new mongoose.Schema({
  chatId: {
    type: Number,
    required: true,
    index: true
  },
  chatTitle: {
    type: String,
    default: 'Личный чат'
  },
  hostId: {
    type: Number,
    required: true
  },
  hostUsername: String,
  word: {
    type: String,
    required: true
  },
  players: [{
    userId: Number,
    username: String,
    score: {
      type: Number,
      default: 0
    }
  }],
  winner: {
    userId: Number,
    username: String,
    finalScore: Number
  },
  totalDuration: Number, // в секундах
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Схема для общей статистики чата
const chatStatsSchema = new mongoose.Schema({
  chatId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  chatTitle: String,
  totalGames: {
    type: Number,
    default: 0
  },
  playerStats: [{
    userId: Number,
    username: String,
    gamesPlayed: Number,
    gamesWon: Number,
    totalPoints: Number
  }],
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

const GameResult = mongoose.model('GameResult', gameResultSchema);
const ChatStats = mongoose.model('ChatStats', chatStatsSchema);

module.exports = { GameResult, ChatStats };
