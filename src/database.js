const mongoose = require('mongoose');
const { GameResult, ChatStats } = require('./models');
const { formatTime } = require('./time');
const { RATING_FIELDS, categoryValue } = require('./ratingValues');

class Database {
  constructor(mongoUri) {
    this.mongoUri = mongoUri;
  }

  async connect() {
    try {
      await mongoose.connect(this.mongoUri);
      console.log(`[${formatTime()}] ✓ Подключено к MongoDB`);
    } catch (error) {
      console.error('✗ Ошибка подключения к MongoDB:', error);
      throw error;
    }
  }

  async disconnect() {
    try {
      await mongoose.disconnect();
      console.log('✓ Отключено от MongoDB');
    } catch (error) {
      console.error('✗ Ошибка отключения от MongoDB:', error);
      throw error;
    }
  }

  // Сохранить результат игры и обновить статистику чата
  async saveGameResult(chatId, chatTitle, gameState, hostId, hostUsername) {
    try {
      // Победитель — лидер по очкам, если игра не закончилась выбыванием всех
      let winner = null;
      if (gameState.hasWinner) {
        const scoresTable = gameState.getScoresTable();
        if (scoresTable.length > 0) {
          winner = {
            userId: scoresTable[0].userId,
            username: scoresTable[0].username,
            finalScore: scoresTable[0].score
          };
        }
      }

      const playersData = gameState.players.map(player => ({
        userId: player.id,
        username: player.username,
        score: gameState.getPlayerScore(player.id)
      }));

      const gameResult = new GameResult({
        chatId,
        chatTitle,
        hostId,
        hostUsername,
        word: gameState.word,
        players: playersData,
        winner: winner || { userId: null, username: null, finalScore: 0 }
      });

      await gameResult.save();
      await this.updateChatStats(chatId, chatTitle, playersData, winner);
      console.log(`[${formatTime()}] ✓ Результат игры сохранён (игроков: ${playersData.length})`);

      return gameResult;
    } catch (error) {
      console.error('Ошибка сохранения результата игры:', error);
      throw error;
    }
  }

  // Обновить статистику чата
  async updateChatStats(chatId, chatTitle, players, winner) {
    try {
      let chatStats = await ChatStats.findOne({ chatId });

      if (!chatStats) {
        chatStats = new ChatStats({
          chatId,
          chatTitle,
          totalGames: 0,
          playerStats: []
        });
      }

      chatStats.totalGames += 1;
      chatStats.chatTitle = chatTitle;

      for (const player of players) {
        const isWinner = winner && winner.userId === player.userId;
        const playerStat = chatStats.playerStats.find(p => p.userId === player.userId);

        if (!playerStat) {
          chatStats.playerStats.push({
            userId: player.userId,
            username: player.username,
            gamesPlayed: 1,
            gamesWon: isWinner ? 1 : 0,
            totalPoints: player.score
          });
        } else {
          playerStat.username = player.username;
          playerStat.gamesPlayed += 1;
          playerStat.totalPoints += player.score;
          if (isWinner) {
            playerStat.gamesWon += 1;
          }
        }
      }

      chatStats.updatedAt = new Date();
      // Пометить массив как изменённый, чтобы Mongoose сохранил вложенные правки
      chatStats.markModified('playerStats');
      await chatStats.save();

      return chatStats;
    } catch (error) {
      console.error('Ошибка обновления статистики чата:', error);
      throw error;
    }
  }

  // Получить статистику чата
  async getChatStats(chatId) {
    try {
      return await ChatStats.findOne({ chatId });
    } catch (error) {
      console.error('Ошибка получения статистики чата:', error);
      throw error;
    }
  }

  // Получить игры чата, новые первыми (limit = null — все игры)
  async getRecentGames(chatId, limit = null) {
    try {
      const query = GameResult.find({ chatId }).sort({ createdAt: -1 });
      if (limit) {
        query.limit(limit);
      }
      return await query;
    } catch (error) {
      console.error('Ошибка получения игр:', error);
      throw error;
    }
  }

  // Поставить/изменить оценку игры в категории field: difficulty | question |
  // process (голосуют только игроки партии). Возвращает среднюю по категории
  async rateWord(gameResultId, userId, username, field, rating) {
    try {
      const gameResult = await GameResult.findById(gameResultId);
      if (!gameResult) return null;

      if (!gameResult.players.find(p => p.userId === userId)) {
        return { notPlayer: true };
      }

      const existing = gameResult.ratings.find(r => r.userId === userId);
      if (existing) {
        existing[field] = rating;
        existing.username = username;
      } else {
        gameResult.ratings.push({ userId, username, [field]: rating });
      }

      gameResult.markModified('ratings');
      await gameResult.save();

      const values = gameResult.ratings
        .map(r => categoryValue(r, field))
        .filter(value => value != null);
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      return { word: gameResult.word, average, count: values.length };
    } catch (error) {
      console.error('Ошибка сохранения оценки слова:', error);
      throw error;
    }
  }

  // Рейтинг слов чата: средние оценки по трём категориям, сортировка по сложности.
  // Игр в чате немного, поэтому агрегируем в JS — так учитывается старая шкала
  async getWordRatings(chatId, limit = 10) {
    try {
      const games = await GameResult.find({ chatId, 'ratings.0': { $exists: true } }).lean();

      const byWord = new Map();
      for (const game of games) {
        const acc = byWord.get(game.word) || { word: game.word, difficulty: [], question: [], process: [] };
        for (const entry of game.ratings) {
          for (const field of RATING_FIELDS) {
            const value = categoryValue(entry, field);
            if (value != null) acc[field].push(value);
          }
        }
        byWord.set(game.word, acc);
      }

      const average = values => values.length
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : null;

      return [...byWord.values()]
        .map(w => ({
          word: w.word,
          difficulty: average(w.difficulty),
          question: average(w.question),
          process: average(w.process),
          votes: Math.max(w.difficulty.length, w.question.length, w.process.length),
        }))
        .filter(w => w.votes > 0)
        .sort((a, b) => (b.difficulty ?? -1) - (a.difficulty ?? -1))
        .slice(0, limit);
    } catch (error) {
      console.error('Ошибка получения рейтинга слов:', error);
      throw error;
    }
  }

  // Зарегистрировать игрока (добавить в список всех игроков чата)
  async registerPlayer(chatId, chatTitle, userId, username) {
    try {
      let chatStats = await ChatStats.findOne({ chatId });

      if (!chatStats) {
        chatStats = new ChatStats({
          chatId,
          chatTitle,
          registeredPlayers: [{ userId, username }]
        });
      } else if (!chatStats.registeredPlayers.find(p => p.userId === userId)) {
        chatStats.registeredPlayers.push({ userId, username });
        chatStats.markModified('registeredPlayers');
      }

      await chatStats.save();
      return chatStats;
    } catch (error) {
      console.error('Ошибка регистрации игрока:', error);
      throw error;
    }
  }

  // Получить всех зарегистрированных игроков в чате
  async getRegisteredPlayers(chatId) {
    try {
      const chatStats = await ChatStats.findOne({ chatId });
      return chatStats?.registeredPlayers || [];
    } catch (error) {
      console.error('Ошибка получения зарегистрированных игроков:', error);
      throw error;
    }
  }
}

module.exports = Database;
