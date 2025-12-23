const { Telegraf } = require('telegraf');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// Хранилище игр по чатам
const games = new Map();

// Состояние игры
class GameState {
  constructor() {
    this.word = ''; // Загаданное слово
    this.hostId = null; // ID ведущего
    this.players = []; // Список участников
    this.currentPlayerIndex = 0; // Индекс текущего игрока
    this.guessedLetters = new Set(); // Угаданные буквы
    this.isActive = false; // Активна ли игра
    this.scores = new Map(); // Очки игроков (userId -> score)
    this.letterPoints = new Map(); // Очки за каждую букву (letter -> points)
  }

  // Генерировать случайные очки (100-1000, кратно 100)
  generatePoints() {
    const min = 1; // 100 очков
    const max = 10; // 1000 очков
    const multiplier = Math.floor(Math.random() * (max - min + 1)) + min;
    return multiplier * 100;
  }

  // Добавить очки игроку
  addPoints(userId, points) {
    const currentScore = this.scores.get(userId) || 0;
    this.scores.set(userId, currentScore + points);
    return this.scores.get(userId);
  }

  // Получить очки игрока
  getPlayerScore(userId) {
    return this.scores.get(userId) || 0;
  }

  // Получить таблицу очков (отсортированную)
  getScoresTable() {
    const scoresArray = Array.from(this.scores.entries())
      .map(([userId, score]) => {
        const player = this.players.find(p => p.id === userId);
        return {
          username: player?.username || 'неизвестно',
          score: score
        };
      })
      .sort((a, b) => b.score - a.score);
    
    return scoresArray;
  }

  // Получить текущее отображение слова
  getDisplayWord() {
    return this.word
      .split('')
      .map(letter => {
        const upperLetter = letter.toUpperCase();
        if (this.guessedLetters.has(upperLetter) || letter === ' ') {
          return letter;
        }
        return '█';
      })
      .join('');
  }

  // Проверить, угадана ли буква
  guessLetter(letter, userId) {
    const upperLetter = letter.toUpperCase();
    if (this.guessedLetters.has(upperLetter)) {
      return { success: false, message: 'Эта буква уже была угадана!' };
    }

    if (this.word.toUpperCase().includes(upperLetter)) {
      this.guessedLetters.add(upperLetter);
      const isComplete = this.getDisplayWord().split('').every(char => char !== '█');
      
      // Подсчитываем количество вхождений буквы в слове
      const letterCount = (this.word.toUpperCase().match(new RegExp(upperLetter, 'g')) || []).length;
      
      // Генерируем случайные очки за одну букву
      const basePoints = this.generatePoints();
      
      // Умножаем очки на количество вхождений буквы
      const totalPoints = basePoints * letterCount;
      
      // Сохраняем базовые очки за эту букву (без умножения) для статистики
      if (!this.letterPoints.has(upperLetter) || this.letterPoints.get(upperLetter) < basePoints) {
        this.letterPoints.set(upperLetter, basePoints);
      }
      
      const newTotal = this.addPoints(userId, totalPoints);
      
      // Формируем сообщение в зависимости от количества вхождений
      let message = `Буква "${letter.toUpperCase()}" есть в слове!`;
      if (letterCount > 1) {
        message += ` (встречается ${letterCount} раз${letterCount === 2 || letterCount === 3 || letterCount === 4 ? 'а' : ''})`;
      }
      
      return { 
        success: true, 
        message: message,
        isComplete,
        points: totalPoints,
        basePoints: basePoints,
        letterCount: letterCount,
        totalScore: newTotal
      };
    }

    return { success: false, message: `Буквы "${letter.toUpperCase()}" нет в слове.` };
  }

  // Проверить, завершена ли игра
  isComplete() {
    return this.getDisplayWord().split('').every(char => char !== '█');
  }

  // Добавить игрока
  addPlayer(userId, username) {
    if (!this.players.find(p => p.id === userId)) {
      this.players.push({ id: userId, username: username || `Игрок ${this.players.length + 1}` });
      // Инициализируем очки для нового игрока
      if (!this.scores.has(userId)) {
        this.scores.set(userId, 0);
      }
    }
  }

  // Получить следующего игрока
  getNextPlayer() {
    if (this.players.length === 0) return null;
    const player = this.players[this.currentPlayerIndex];
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    return player;
  }

  // Получить текущего игрока
  getCurrentPlayer() {
    if (this.players.length === 0 || this.currentPlayerIndex === -1) return null;
    return this.players[this.currentPlayerIndex];
  }

  // Установить текущего игрока по userId
  setCurrentPlayer(userId) {
    const playerIndex = this.players.findIndex(p => p.id === userId);
    if (playerIndex !== -1) {
      this.currentPlayerIndex = playerIndex;
      return true;
    }
    return false;
  }

  // Передать ход следующему игроку
  passTurnToNext() {
    if (this.players.length === 0) return null;
    if (this.currentPlayerIndex === -1) return null;
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    return this.players[this.currentPlayerIndex];
  }

  // Угадать слово целиком или одно слово из фразы
  guessWord(guessedWord, userId) {
    // Нормализуем оба слова для сравнения (убираем лишние пробелы, приводим к верхнему регистру)
    const normalizedGuessed = guessedWord.trim().toUpperCase().replace(/\s+/g, ' ');
    const normalizedWord = this.word.trim().toUpperCase().replace(/\s+/g, ' ');

    // Проверяем, угадано ли все слово целиком
    const isFullWord = normalizedGuessed === normalizedWord;
    
    // Если не все слово, проверяем, является ли угаданное слово одним из слов в фразе
    let targetWord = null;
    if (!isFullWord) {
      const words = this.word.trim().split(/\s+/);
      const guessedWords = guessedWord.trim().split(/\s+/);
      
      // Проверяем, является ли угаданное одно слово частью фразы
      if (guessedWords.length === 1) {
        const guessedSingleWord = guessedWords[0].toUpperCase();
        targetWord = words.find(w => w.toUpperCase() === guessedSingleWord);
      }
    }

    if (isFullWord || targetWord) {
      // Определяем, какое слово угадываем (всё или одно слово)
      const wordToProcess = isFullWord ? this.word : targetWord;
      const isSingleWordGuess = !isFullWord;
      
      // Вычисляем очки только за неотгаданные буквы в угадываемом слове
      const letters = wordToProcess.split('').filter(char => char !== ' '); // Игнорируем пробелы
      const letterPointsDetails = []; // Детали очков за каждую букву
      const uniqueNewLetters = new Set(); // Уникальные новые буквы, за которые начисляем очки
      let totalPoints = 0;
      
      // Подсчитываем количество неотгаданных букв в угадываемом слове
      let unguessedCount = 0;
      letters.forEach(letter => {
        const upperLetter = letter.toUpperCase();
        if (!this.guessedLetters.has(upperLetter)) {
          uniqueNewLetters.add(upperLetter);
          unguessedCount++;
        }
      });
      
      // Проверяем: если осталась только одна неразгаданная буква, бонус = 0
      const shouldGiveBonus = unguessedCount > 1;
      
      // Генерируем очки для уникальных новых букв (с учетом количества вхождений в угадываемом слове)
      uniqueNewLetters.forEach(upperLetter => {
        const basePoints = this.generatePoints();
        // Подсчитываем количество вхождений буквы только в угадываемом слове
        const letterCount = (wordToProcess.toUpperCase().match(new RegExp(upperLetter, 'g')) || []).length;
        // Умножаем очки на количество вхождений
        const pointsForLetter = basePoints * letterCount;
        totalPoints += pointsForLetter;
        // Сохраняем базовые очки за эту букву (без умножения) для статистики
        // Если буква уже была угадана ранее, берем максимальное значение
        if (!this.letterPoints.has(upperLetter) || this.letterPoints.get(upperLetter) < basePoints) {
          this.letterPoints.set(upperLetter, basePoints);
        }
        // Отмечаем букву как угаданную
        this.guessedLetters.add(upperLetter);
      });
      
      // Формируем детальную статистику для уникальных букв угадываемого слова (в порядке первого появления)
      const seenLetters = new Set();
      letters.forEach(letter => {
        const upperLetter = letter.toUpperCase();
        if (!seenLetters.has(upperLetter)) {
          seenLetters.add(upperLetter);
          // Подсчитываем количество вхождений буквы в угадываемом слове
          const letterCount = (wordToProcess.toUpperCase().match(new RegExp(upperLetter, 'g')) || []).length;
          
          if (uniqueNewLetters.has(upperLetter)) {
            // Новая буква, за которую начислены очки
            const basePoints = this.letterPoints.get(upperLetter);
            const totalPointsForLetter = basePoints * letterCount;
            letterPointsDetails.push({ 
              letter: upperLetter, 
              basePoints: basePoints,
              letterCount: letterCount,
              totalPoints: totalPointsForLetter
            });
          } else {
            // Буква уже была угадана ранее
            const savedBasePoints = this.letterPoints.get(upperLetter) || 0;
            const savedTotalPoints = savedBasePoints * letterCount;
            letterPointsDetails.push({ 
              letter: upperLetter, 
              basePoints: savedBasePoints,
              letterCount: letterCount,
              totalPoints: savedTotalPoints,
              alreadyGuessed: true 
            });
          }
        }
      });

      // Добавляем 1/3 от суммы очков за неотгаданные буквы (только если осталось больше 1 буквы)
      const bonus = shouldGiveBonus ? Math.floor(totalPoints / 3) : 0;
      const finalPoints = totalPoints + bonus;
      
      const newTotal = this.addPoints(userId, finalPoints);

      // Формируем сообщение
      let message;
      if (isFullWord) {
        message = `🎉 Правильно! Слово "${this.word}" угадано!`;
      } else {
        message = `🎉 Правильно! Слово "${targetWord}" угадано!`;
      }

      return {
        success: true,
        message: message,
        points: finalPoints,
        basePoints: totalPoints,
        bonus: bonus,
        totalScore: newTotal,
        letterPointsDetails: letterPointsDetails,
        isSingleWordGuess: isSingleWordGuess,
        guessedWord: isFullWord ? this.word : targetWord
      };
    }

    return {
      success: false,
      message: `❌ Неправильно! Это не то слово.`
    };
  }

  // Получить детальную статистику очков за буквы
  getLetterPointsDetails() {
    const details = [];
    const letters = this.word.split('').filter(char => char !== ' ');
    const seenLetters = new Set();
    
    letters.forEach(letter => {
      const upperLetter = letter.toUpperCase();
      if (!seenLetters.has(upperLetter)) {
        seenLetters.add(upperLetter);
        const basePoints = this.letterPoints.get(upperLetter) || 0;
        // Подсчитываем количество вхождений буквы в слове
        const letterCount = (this.word.toUpperCase().match(new RegExp(upperLetter, 'g')) || []).length;
        const totalPoints = basePoints * letterCount;
        details.push({ 
          letter: upperLetter, 
          basePoints: basePoints,
          letterCount: letterCount,
          totalPoints: totalPoints
        });
      }
    });
    
    return details;
  }
}

// Получить или создать игру для чата
function getGame(chatId) {
  if (!games.has(chatId)) {
    games.set(chatId, new GameState());
  }
  return games.get(chatId);
}

// Форматировать детальную статистику очков за буквы
function formatLetterPointsDetails(game) {
  const details = game.getLetterPointsDetails();
  if (details.length === 0) {
    return '';
  }

  const detailsText = details
    .map(d => {
      let detail = `   "${d.letter}": `;
      if (d.letterCount > 1) {
        detail += `${d.basePoints} очков × ${d.letterCount} вхождений = ${d.totalPoints} очков`;
      } else {
        detail += `${d.totalPoints} очков`;
      }
      return detail;
    })
    .join('\n');
  
  const totalBase = details.reduce((sum, d) => sum + d.totalPoints, 0);
  const bonus = Math.floor(totalBase / 3);
  const total = totalBase + bonus;

  return `\n📊 Детальная статистика очков:\n${detailsText}\n   Итого за буквы: ${totalBase} очков\n   Бонус (+1/3): ${bonus} очков\n   Всего: ${total} очков`;
}

// Команда /start
bot.command('start', (ctx) => {
  ctx.reply(
    '🎰 Добро пожаловать в игру "Поле чудес"!\n\n' +
    '📋 Команды:\n' +
    '/newgame - Начать новую игру (для ведущего)\n' +
    '/word <слово> - Загадать слово (для ведущего)\n' +
    '/join - Присоединиться к игре\n' +
    '/status - Показать текущее состояние игры\n' +
    '/guess <слово> - Угадать слово целиком\n' +
    '/next - Передать ход следующему игроку (только для текущего игрока)\n' +
    '/end - Завершить игру (для ведущего)\n\n' +
    '💡 Первый, кто предложит букву - начнет игру!\n' +
    '💡 При правильном ответе ваш ход продолжается, при ошибке - ход переходит следующему.'
  );
});

// Команда /newgame - начать новую игру
bot.command('newgame', (ctx) => {
  const game = getGame(ctx.chat.id);
  game.isActive = false;
  game.word = '';
  game.hostId = ctx.from.id;
  game.players = [];
  game.currentPlayerIndex = -1;
  game.guessedLetters.clear();
  game.scores.clear();
  game.letterPoints.clear();
  
  ctx.reply(
    '🎮 Новая игра начата!\n' +
    `👤 Ведущий: @${ctx.from.username || ctx.from.first_name}\n\n` +
    'Используйте /word <слово> чтобы загадать слово.\n' +
    'Участники могут использовать /join чтобы присоединиться.'
  );
});

// Команда /word - загадать слово (только для ведущего)
bot.command('word', (ctx) => {
  const game = getGame(ctx.chat.id);
  
  if (!game.hostId) {
    return ctx.reply('❌ Сначала начните игру командой /newgame');
  }

  if (game.hostId !== ctx.from.id) {
    return ctx.reply('❌ Только ведущий может загадывать слово!');
  }

  const word = ctx.message.text.split(' ').slice(1).join(' ').trim();
  
  if (!word) {
    return ctx.reply('❌ Укажите слово! Например: /word ПРИМЕР');
  }

  // Проверка на валидность слова (только буквы и пробелы)
  if (!/^[А-Яа-яЁёA-Za-z\s]+$/.test(word)) {
    return ctx.reply('❌ Слово должно содержать только буквы и пробелы!');
  }

  game.word = word;
  game.isActive = true;
  game.guessedLetters.clear();
  game.currentPlayerIndex = -1; // -1 означает, что еще никто не начал ходить
  game.scores.clear(); // Сбрасываем очки при новом слове
  game.letterPoints.clear(); // Сбрасываем очки за буквы

  // Ведущий НЕ добавляется в список игроков

  const displayWord = game.getDisplayWord();
  
  ctx.reply(
    `🎯 Слово загадано!\n\n` +
    `📝 Слово: ${displayWord}\n\n` +
    `👥 Игроки: ${game.players.length}\n\n` +
    `💬 Участники, первый кто предложит букву - начнет игру!`
  );
});

// Команда /join - присоединиться к игре
bot.command('join', (ctx) => {
  const game = getGame(ctx.chat.id);
  
  if (!game.isActive && !game.word) {
    return ctx.reply('❌ Игра еще не начата. Дождитесь, пока ведущий загадает слово.');
  }

  game.addPlayer(ctx.from.id, ctx.from.username || ctx.from.first_name);
  
  ctx.reply(
    `✅ @${ctx.from.username || ctx.from.first_name} присоединился к игре!\n` +
    `👥 Всего игроков: ${game.players.length}`
  );
});

// Команда /status - показать статус игры
bot.command('status', (ctx) => {
  const game = getGame(ctx.chat.id);
  
  if (!game.word) {
    return ctx.reply('❌ Игра еще не начата.');
  }

  const displayWord = game.getDisplayWord();
  const currentPlayer = game.getCurrentPlayer();
  const playersList = game.players
    .map((p, idx) => {
      const marker = idx === game.currentPlayerIndex ? '🎲' : '👤';
      return `${marker} @${p.username || 'игрок'}`;
    })
    .join('\n');

  // Таблица очков
  const scoresTable = game.getScoresTable();
  const scoresList = scoresTable.length > 0
    ? scoresTable
        .map((p, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
          return `${medal} @${p.username}: ${p.score} очков`;
        })
        .join('\n')
    : 'Очки пока не начислены';

  ctx.reply(
    `📊 Статус игры:\n\n` +
    `📝 Слово: ${displayWord}\n\n` +
    `🎲 Текущий ход: @${currentPlayer?.username || 'неизвестно'}\n\n` +
    `👥 Игроки (${game.players.length}):\n${playersList}\n\n` +
    `✅ Угаданные буквы: ${Array.from(game.guessedLetters).sort().join(', ') || 'нет'}\n\n` +
    `🏆 Таблица очков:\n${scoresList}`
  );
});

// Команда /guess - угадать слово целиком
bot.command('guess', (ctx) => {
  const game = getGame(ctx.chat.id);
  
  // Проверяем, активна ли игра
  if (!game.isActive || !game.word) {
    return ctx.reply('❌ Игра еще не начата.');
  }

  // Проверяем, что игрок участвует в игре
  const player = game.players.find(p => p.id === ctx.from.id);
  if (!player) {
    return ctx.reply('❌ Вы не участвуете в игре. Используйте /join чтобы присоединиться.');
  }

  // Если еще никто не ходил, устанавливаем текущего игрока
  if (game.currentPlayerIndex === -1) {
    game.setCurrentPlayer(ctx.from.id);
  } else {
    // Проверяем, что это ход текущего игрока
    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== ctx.from.id) {
      return ctx.reply(`⏳ Сейчас не ваш ход! Ход игрока @${currentPlayer?.username || 'неизвестно'}`);
    }
  }

  const guessedWord = ctx.message.text.split(' ').slice(1).join(' ').trim();
  
  if (!guessedWord) {
    return ctx.reply('❌ Укажите слово! Например: /guess ПРИМЕР');
  }

  // Проверка на валидность слова (только буквы и пробелы)
  if (!/^[А-Яа-яЁёA-Za-z\s]+$/.test(guessedWord)) {
    return ctx.reply('❌ Слово должно содержать только буквы и пробелы!');
  }

  // Пытаемся угадать слово
  const result = game.guessWord(guessedWord, ctx.from.id);
  
  if (result.success) {
    // Проверяем, завершена ли игра (все буквы угаданы)
    const isComplete = game.isComplete();
    
    // Формируем детальную статистику очков за буквы
    const letterDetails = result.letterPointsDetails
      .map(d => {
        let detail = `   "${d.letter}": `;
        if (d.letterCount > 1) {
          detail += `${d.basePoints} очков × ${d.letterCount} вхождений = ${d.totalPoints} очков`;
        } else {
          detail += `${d.totalPoints} очков`;
        }
        if (d.alreadyGuessed) {
          detail += ' (уже была угадана)';
        }
        return detail;
      })
      .join('\n');
    
    let bonusMessage = '';
    if (result.bonus > 0) {
      bonusMessage = `   (Базовые очки за новые буквы: ${result.basePoints} + бонус: ${result.bonus})`;
    } else {
      bonusMessage = `   (Базовые очки за новые буквы: ${result.basePoints}, бонус не начислен - оставалась только одна буква)`;
    }
    
    if (isComplete) {
      // Игра завершена - все буквы угаданы
      const scoresTable = game.getScoresTable();
      const finalScores = scoresTable.length > 0
        ? '\n\n🏆 Финальная таблица очков:\n' + scoresTable
            .map((p, idx) => {
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
              return `${medal} @${p.username}: ${p.score} очков`;
            })
            .join('\n')
        : '';
      
      ctx.reply(
        `${result.message}\n\n` +
        `💰 Вы получили ${result.points} очков!\n${bonusMessage}\n` +
        `   Всего у вас: ${result.totalScore} очков\n\n` +
        `📊 Детальная статистика очков:\n${letterDetails}\n` +
        `   Итого за новые буквы: ${result.basePoints} очков\n` +
        `   Бонус (+1/3): ${result.bonus} очков\n` +
        `   Всего получено: ${result.points} очков\n\n` +
        `🏆 Слово полностью угадано: ${game.word}${finalScores}\n\n` +
        `🎮 Игра завершена! Используйте /newgame для новой игры.`
      );
      
      game.isActive = false;
    } else {
      // Игра продолжается - угадано одно слово из фразы или не все буквы
      // Игрок продолжает ходить (не передаем ход)
      ctx.reply(
        `${result.message}\n\n` +
        `💰 Вы получили ${result.points} очков!\n${bonusMessage}\n` +
        `   Всего у вас: ${result.totalScore} очков\n\n` +
        `📊 Детальная статистика очков:\n${letterDetails}\n` +
        `   Итого за новые буквы: ${result.basePoints} очков\n` +
        `   Бонус (+1/3): ${result.bonus} очков\n` +
        `   Всего получено: ${result.points} очков\n\n` +
        `📝 Слово: ${game.getDisplayWord()}\n\n` +
        `🎲 Ваш ход продолжается! Можете угадывать еще.`
      );
    }
  } else {
    // Слово не угадано - передаем ход следующему игроку
    const nextPlayer = game.passTurnToNext();
    if (nextPlayer) {
      ctx.reply(
        `${result.message}\n\n` +
        `📝 Слово: ${game.getDisplayWord()}\n\n` +
        `🎲 Следующий ход: @${nextPlayer.username || 'неизвестно'}`
      );
    } else {
      ctx.reply(
        `${result.message}\n\n` +
        `📝 Слово: ${game.getDisplayWord()}`
      );
    }
  }
});

// Команда /next - передать ход следующему игроку
bot.command('next', (ctx) => {
  const game = getGame(ctx.chat.id);
  
  // Проверяем, активна ли игра
  if (!game.isActive || !game.word) {
    return ctx.reply('❌ Игра еще не начата.');
  }

  // Проверяем, что это ход текущего игрока
  const currentPlayer = game.getCurrentPlayer();
  if (!currentPlayer || currentPlayer.id !== ctx.from.id) {
    return ctx.reply(`⏳ Сейчас не ваш ход! Ход игрока @${currentPlayer?.username || 'неизвестно'}`);
  }

  // Передаем ход следующему игроку
  const nextPlayer = game.passTurnToNext();
  if (nextPlayer) {
    ctx.reply(
      `✅ Ход передан следующему игроку!\n\n` +
      `📝 Слово: ${game.getDisplayWord()}\n\n` +
      `🎲 Следующий ход: @${nextPlayer.username || 'неизвестно'}`
    );
  } else {
    ctx.reply('❌ Не удалось передать ход. Нет других игроков.');
  }
});

// Команда /end - завершить игру
bot.command('end', (ctx) => {
  const game = getGame(ctx.chat.id);
  
  if (!game.hostId) {
    return ctx.reply('❌ Игра не начата.');
  }

  if (game.hostId !== ctx.from.id) {
    return ctx.reply('❌ Только ведущий может завершить игру!');
  }

  const word = game.word || 'не загадано';
  
  // Показываем финальную таблицу очков
  const scoresTable = game.getScoresTable();
  const finalScores = scoresTable.length > 0
    ? '\n\n🏆 Финальная таблица очков:\n' + scoresTable
        .map((p, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
          return `${medal} @${p.username}: ${p.score} очков`;
        })
        .join('\n')
    : '';
  
  // Детальная статистика очков за буквы
  const letterDetails = formatLetterPointsDetails(game);
  
  game.isActive = false;
  game.word = '';
  game.players = [];
  game.currentPlayerIndex = -1;
  game.guessedLetters.clear();
  game.scores.clear();
  game.letterPoints.clear();
  game.hostId = null;

  ctx.reply(`🏁 Игра завершена!\n📝 Загаданное слово было: ${word}${letterDetails}${finalScores}`);
});

// Обработка букв от участников
bot.on('text', (ctx) => {
  const game = getGame(ctx.chat.id);
  
  // Игнорируем команды
  if (ctx.message.text.startsWith('/')) {
    return;
  }

  // Проверяем, активна ли игра
  if (!game.isActive || !game.word) {
    return;
  }

  // Проверяем, что это буква (одна буква)
  const text = ctx.message.text.trim();
  if (text.length !== 1) {
    return;
  }

  // Проверяем, что это буква
  if (!/^[А-Яа-яЁёA-Za-z]$/.test(text)) {
    return;
  }

  // Проверяем, что игрок участвует в игре
  const player = game.players.find(p => p.id === ctx.from.id);
  if (!player) {
    return; // Игрок не участвует, игнорируем
  }

  // Если еще никто не ходил, устанавливаем текущего игрока
  if (game.currentPlayerIndex === -1) {
    game.setCurrentPlayer(ctx.from.id);
  } else {
    // Проверяем, что это ход текущего игрока
    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== ctx.from.id) {
      ctx.reply(`⏳ Сейчас не ваш ход! Ход игрока @${currentPlayer?.username || 'неизвестно'}`);
      return;
    }
  }

  // Обрабатываем букву
  const result = game.guessLetter(text, ctx.from.id);
  
  if (result.success) {
    const displayWord = game.getDisplayWord();
    
    if (result.isComplete) {
      // Игра завершена!
      const scoresTable = game.getScoresTable();
      const finalScores = scoresTable.length > 0
        ? '\n\n🏆 Финальная таблица очков:\n' + scoresTable
            .map((p, idx) => {
              const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
              return `${medal} @${p.username}: ${p.score} очков`;
            })
            .join('\n')
        : '';
      
      // Детальная статистика очков за буквы
      const letterDetails = formatLetterPointsDetails(game);
      
      let pointsMessage = `💰 Вы получили ${result.points} очков!`;
      if (result.letterCount > 1) {
        pointsMessage += `\n   (${result.basePoints} очков × ${result.letterCount} вхождений = ${result.points} очков)`;
      }
      pointsMessage += `\n   Всего у вас: ${result.totalScore} очков`;
      
      ctx.reply(
        `🎉 Поздравляем! Игрок @${ctx.from.username || ctx.from.first_name} угадал последнюю букву!\n\n` +
        `${pointsMessage}\n\n` +
        `🏆 Слово полностью угадано: ${game.word}${letterDetails}${finalScores}\n\n` +
        `🎮 Игра завершена! Используйте /newgame для новой игры.`
      );
      
      game.isActive = false;
    } else {
      // Буква угадана, но игра продолжается - игрок продолжает ходить
      let pointsMessage = `💰 Вы получили ${result.points} очков!`;
      if (result.letterCount > 1) {
        pointsMessage += `\n   (${result.basePoints} очков × ${result.letterCount} вхождений = ${result.points} очков)`;
      }
      pointsMessage += `\n   Всего у вас: ${result.totalScore} очков`;
      
      ctx.reply(
        `✅ ${result.message}\n\n` +
        `${pointsMessage}\n\n` +
        `📝 Слово: ${displayWord}\n\n` +
        `🎲 Ваш ход продолжается! Можете угадывать еще.`
      );
    }
  } else {
    // Буква не угадана - передаем ход следующему игроку
    const nextPlayer = game.passTurnToNext();
    if (nextPlayer) {
      ctx.reply(
        `❌ ${result.message}\n\n` +
        `📝 Слово: ${game.getDisplayWord()}\n\n` +
        `🎲 Следующий ход: @${nextPlayer.username || 'неизвестно'}`
      );
    } else {
      ctx.reply(
        `❌ ${result.message}\n\n` +
        `📝 Слово: ${game.getDisplayWord()}`
      );
    }
  }
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}:`, err);
  ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.');
});

// Запуск бота
bot.launch().then(() => {
  console.log('🤖 Бот запущен!');
}).catch((err) => {
  console.error('Ошибка запуска бота:', err);
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

