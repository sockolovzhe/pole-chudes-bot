const mongoose = require('mongoose');
const { GameResult, ChatStats } = require('./models/GameResult');

// Функция для получения времени по Екатеринбургу (UTC+5)
function getEkaterinburgTime() {
  const now = new Date();
  // Получаем UTC время и добавляем 5 часов для Екатеринбурга
  const utcTime = new Date(now.getTime() + now.getTimezoneOffset() * 60 * 1000);
  const ekbTime = new Date(utcTime.getTime() + 5 * 60 * 60 * 1000);
  return ekbTime;
}

// Функция для форматирования времени
function formatTime(date = null) {
  const d = date || getEkaterinburgTime();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

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

  // Сохранить результат игры
  async saveGameResult(chatId, chatTitle, gameState, hostId, hostUsername) {
    try {
      // Определяем победителя только если игра имела победителя
      let winner = null;
      if (gameState.hasWinner) {
        const scoresTable = gameState.getScoresTable();
        winner = scoresTable && scoresTable.length > 0 ? {
          userId: gameState.players.find(p => p.username === scoresTable[0].username)?.id,
          username: scoresTable[0].username,
          finalScore: scoresTable[0].score
        } : null;
      }
      
      const playersData = gameState.players.map(player => ({
        userId: player.id,
        username: player.username,
        score: gameState.getPlayerScore(player.id) || 0
      }));

      console.log(`[${formatTime()}] DEBUG saveGameResult:`);
      console.log('  gameState.players:', gameState.players);
      console.log('  playersData:', playersData);
      console.log('  hasWinner:', gameState.hasWinner);
      console.log('  Winner:', winner);
      console.log('  Всего игроков для сохранения:', playersData.length);

      const gameResult = new GameResult({
        chatId,
        chatTitle,
        hostId,
        hostUsername,
        word: gameState.word,
        players: playersData,
        winner: winner || {
          userId: null,
          username: null,
          finalScore: 0
        }
      });

      await gameResult.save();
      console.log('  Сохранено в GameResult');
      
      await this.updateChatStats(chatId, chatTitle, playersData, winner);
      console.log(`[${formatTime()}] ✅ ChatStats успешно сохранена`);
      
      return gameResult;
    } catch (error) {
      console.error('Ошибка сохранения результата игры:', error);
      throw error;
    }
  }

  // Обновить статистику чата
  async updateChatStats(chatId, chatTitle, players, winner) {
    try {
      console.log(`[${formatTime()}] 📊 updateChatStats START`);
      console.log('  players входящие:', players);
      console.log('  players.length:', players.length);
      
      let chatStats = await ChatStats.findOne({ chatId });

      if (!chatStats) {
        console.log('  Создаем новую запись ChatStats');
        chatStats = new ChatStats({
          chatId,
          chatTitle,
          totalGames: 0,
          playerStats: []
        });
      } else {
        console.log('  Найдена существующая запись ChatStats');
        console.log('  chatStats.playerStats перед:', chatStats.playerStats);
      }

      chatStats.totalGames += 1;
      chatStats.chatTitle = chatTitle;
      console.log('  totalGames после инкремента:', chatStats.totalGames);

      // Обновляем статистику для каждого игрока
      for (const player of players) {
        console.log('  Обработка игрока:', player.userId, player.username);
        let playerStatIndex = chatStats.playerStats.findIndex(p => p.userId === player.userId);
        
        if (playerStatIndex === -1) {
          console.log('    Новый игрок, создаем запись');
          chatStats.playerStats.push({
            userId: player.userId,
            username: player.username,
            gamesPlayed: 1,
            gamesWon: winner && winner.userId === player.userId ? 1 : 0,
            totalPoints: player.score
          });
          console.log('    Новая запись создана');
        } else {
          console.log('    Игрок существует, обновляем');
          const playerStat = chatStats.playerStats[playerStatIndex];
          console.log('    До: gamesPlayed=', playerStat.gamesPlayed, 'totalPoints=', playerStat.totalPoints);
          
          playerStat.username = player.username;
          playerStat.gamesPlayed += 1;
          playerStat.totalPoints += player.score;
          
          if (winner && winner.userId === player.userId) {
            console.log('    Игрок победил!');
            playerStat.gamesWon += 1;
          }
          
          console.log('    После: gamesPlayed=', playerStat.gamesPlayed, 'totalPoints=', playerStat.totalPoints);
          // Перезаписываем элемент массива, чтобы Mongoose отследил изменение
          chatStats.playerStats[playerStatIndex] = playerStat;
        }
      }

      chatStats.updatedAt = new Date();
      // Пометить массив playerStats как изменённый для Mongoose
      chatStats.markModified('playerStats');
      console.log('  chatStats.playerStats перед сохранением:', chatStats.playerStats);
      await chatStats.save();
      console.log('✅ ChatStats успешно сохранена');

      return chatStats;
    } catch (error) {
      console.error('❌ Ошибка обновления статистики чата:', error);
      throw error;
    }
  }

  // Получить статистику чата
  async getChatStats(chatId) {
    try {
      const stats = await ChatStats.findOne({ chatId });
      return stats || null;
    } catch (error) {
      console.error('Ошибка получения статистики чата:', error);
      throw error;
    }
  }

  // Получить статистику игрока в чате
  async getPlayerStats(chatId, userId) {
    try {
      const chatStats = await ChatStats.findOne({ chatId });
      if (!chatStats) return null;

      return chatStats.playerStats.find(p => p.userId === userId) || null;
    } catch (error) {
      console.error('Ошибка получения статистики игрока:', error);
      throw error;
    }
  }

  // Получить последние игры в чате
  async getRecentGames(chatId, limit = 10) {
    try {
      const games = await GameResult.find({ chatId })
        .sort({ createdAt: -1 })
        .limit(limit);
      return games;
    } catch (error) {
      console.error('Ошибка получения игр:', error);
      throw error;
    }
  }

  // Получить топ игроков в чате
  async getTopPlayers(chatId, limit = 10) {
    try {
      const stats = await ChatStats.findOne({ chatId });
      if (!stats) return [];

      return stats.playerStats
        .sort((a, b) => b.totalPoints - a.totalPoints)
        .slice(0, limit);
    } catch (error) {
      console.error('Ошибка получения топ игроков:', error);
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
      } else {
        // Проверяем, есть ли уже такой игрок
        const existingPlayer = chatStats.registeredPlayers.find(p => p.userId === userId);
        if (!existingPlayer) {
          chatStats.registeredPlayers.push({ userId, username });
          chatStats.markModified('registeredPlayers');
        }
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
      if (!chatStats) return [];
      return chatStats.registeredPlayers || [];
    } catch (error) {
      console.error('Ошибка получения зарегистрированных игроков:', error);
      throw error;
    }
  }
}

module.exports = Database;
