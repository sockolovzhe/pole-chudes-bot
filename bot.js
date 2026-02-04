const { Telegraf } = require('telegraf');
require('dotenv').config();
const Database = require('./database');

const bot = new Telegraf(process.env.BOT_TOKEN);
const db = new Database(`mongodb://${process.env.MONGO_ADMIN}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_HOST}:27017/pole-chudes-bot?authSource=admin`);

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
    this.attemptedLetters = new Set(); // Все попытанные буквы (угаданные и неугаданные)
    this.isActive = false; // Активна ли игра
    this.scores = new Map(); // Очки игроков (userId -> score)
    this.letterPoints = new Map(); // Очки за каждую букву (letter -> points)
    this.hasWinner = true; // Есть ли победитель (true по умолчанию, false если все выбыли)
  }

  // Нормализовать символ для сравнения: считать 'Й'='И', 'Ё'='Е', 'Ъ'='Ь' равными
  normalizeChar(ch) {
    if (!ch) return ch;
    const up = ch.toUpperCase();
    if (up === 'Й') return 'И';
    if (up === 'Ё') return 'Е';
    return up;
  }

  // Нормализовать строку для сравнения (убрать лишние пробелы, привести к верхнему регистру и заменить Й→И, Ё→Е)
  normalizeStringForCompare(s) {
    return s.trim().toUpperCase().replace(/\s+/g, ' ').replace(/Й/g, 'И').replace(/Ё/g, 'Е');
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
        if (letter === ' ') return '   ';
        const norm = this.normalizeChar(letter);
        if (this.guessedLetters.has(norm)) {
          const upperLetter = letter.toUpperCase();
          return ` ${upperLetter} `;
        }
        return ' █ ';
      })
      .join('');
  }

  // Проверить, угадана ли буква
  guessLetter(letter, userId) {
    const upperLetter = letter.toUpperCase();
    const normLetter = this.normalizeChar(upperLetter);
    
    if (this.guessedLetters.has(normLetter)) {
      return { success: false, message: 'Эта буква уже была угадана!', alreadyTried: true };
    }
    
    // Проверяем, была ли эта буква попыткой раньше (но не угадана)
    const wasAttemptedBefore = this.attemptedLetters.has(normLetter);
    
    // Добавляем букву в список всех попыток
    this.attemptedLetters.add(normLetter);

    // Подсчитываем количество вхождений нормализованной буквы в слове
    let letterCount = 0;
    for (const ch of this.word.split('')) {
      if (ch === ' ') continue;
      if (this.normalizeChar(ch) === normLetter) letterCount++;
    }

    if (letterCount > 0) {
      this.guessedLetters.add(normLetter);
      const isComplete = this.getDisplayWord().split('').every(char => char !== '█');

      // Генерируем случайные очки за одну букву
      const basePoints = this.generatePoints();

      // Умножаем очки на количество вхождений буквы
      const totalPoints = basePoints * letterCount;

      // Сохраняем базовые очки за эту букву (без умножения) для статистики
      if (!this.letterPoints.has(normLetter) || this.letterPoints.get(normLetter) < basePoints) {
        this.letterPoints.set(normLetter, basePoints);
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

    // Буква не в слове
    if (wasAttemptedBefore) {
      return { success: false, message: `Буквы "${letter.toUpperCase()}" нет в слове (уже пробовали).`, alreadyTried: true };
    }
    
    return { success: false, message: `Буквы "${letter.toUpperCase()}" нет в слове.`, alreadyTried: false };
  }

  // Проверить, завершена ли игра
  isComplete() {
    return this.getDisplayWord().split('').every(char => char !== '█');
  }

  // Добавить игрока
  addPlayer(userId, username) {
    // Не добавляем ведущего в список игроков
    if (userId === this.hostId) {
      return;
    }
    if (!this.players.find(p => p.id === userId)) {
      this.players.push({ id: userId, username: username || `Игрок ${this.players.length + 1}`, isActive: true });
      // Инициализируем очки для нового игрока
      if (!this.scores.has(userId)) {
        this.scores.set(userId, 0);
      }
    }
  }

  // Исключить игрока из очереди ходов (но он остаётся в игре для статистики)
  excludePlayerFromTurns(userId) {
    const player = this.players.find(p => p.id === userId);
    if (player) {
      player.isActive = false;
      // Если исключённый игрок был текущим, передаём ход следующему активному
      const currentPlayer = this.getCurrentPlayer();
      if (currentPlayer && currentPlayer.id === userId) {
        this.passTurnToNext();
      }
      return true;
    }
    return false;
  }

  // Получить количество активных игроков
  getActivePlayers() {
    return this.players.filter(p => p.isActive);
  }

  // Удалить игрока из игры
  removePlayer(userId) {
    const playerIndex = this.players.findIndex(p => p.id === userId);
    if (playerIndex !== -1) {
      this.players.splice(playerIndex, 1);
      // Если удаляем текущего игрока, переходим на следующего
      if (this.currentPlayerIndex >= this.players.length && this.players.length > 0) {
        this.currentPlayerIndex = this.currentPlayerIndex % this.players.length;
      } else if (this.players.length === 0) {
        this.currentPlayerIndex = -1;
      }
      return true;
    }
    return false;
  }

  // Получить следующего игрока
  getNextPlayer() {
    if (this.players.length === 0) return null;
    
    let attempts = 0;
    let nextIndex = (this.currentPlayerIndex + 1) % this.players.length;
    
    // Ищем следующего АКТИВНОГО игрока
    while (attempts < this.players.length) {
      if (this.players[nextIndex].isActive) {
        const player = this.players[nextIndex];
        this.currentPlayerIndex = nextIndex;
        return player;
      }
      nextIndex = (nextIndex + 1) % this.players.length;
      attempts++;
    }
    
    return null; // Нет активных игроков
  }

  // Получить текущего игрока
  getCurrentPlayer() {
    if (this.players.length === 0 || this.currentPlayerIndex === -1) return null;
    return this.players[this.currentPlayerIndex];
  }

  // Установить текущего игрока по userId
  setCurrentPlayer(userId) {
    const playerIndex = this.players.findIndex(p => p.id === userId && p.isActive);
    if (playerIndex !== -1) {
      this.currentPlayerIndex = playerIndex;
      return true;
    }
    return false;
  }

  // Передать ход следующему игроку
  passTurnToNext() {
    if (this.players.length === 0) return null;
    
    let attempts = 0;
    let nextIndex = (this.currentPlayerIndex + 1) % this.players.length;
    
    // Ищем следующего АКТИВНОГО игрока
    while (attempts < this.players.length) {
      if (this.players[nextIndex].isActive) {
        this.currentPlayerIndex = nextIndex;
        return this.players[nextIndex];
      }
      nextIndex = (nextIndex + 1) % this.players.length;
      attempts++;
    }
    
    return null; // Нет активных игроков
  }

  // Угадать слово целиком или одно слово из фразы
  guessWord(guessedWord, userId) {
    // Нормализуем оба слова для сравнения (убираем лишние пробелы, приводим к верхнему регистру и заменяем Й->И)
    const normalizedGuessed = this.normalizeStringForCompare(guessedWord);
    const normalizedWord = this.normalizeStringForCompare(this.word);

    // Проверяем количество слов в загаданном слове
    const wordCount = this.word.trim().split(/\s+/).length;
    
    // Определяем, угадано ли правильно в зависимости от количества слов
    let isCorrect = false;
    let targetWord = null;
    
    if (wordCount === 1) {
      // Если одно слово - должно быть угадано это слово целиком
      isCorrect = normalizedGuessed === normalizedWord;
      targetWord = isCorrect ? this.word : null;
    } else {
      // Если несколько слов - нужно угадать все слова целиком
      const isFullWords = normalizedGuessed === normalizedWord;
      if (isFullWords) {
        isCorrect = true;
        targetWord = this.word;
      } else {
        // Если не все слова, угадывание неправильно
        isCorrect = false;
        targetWord = null;
      }
    }

    if (isCorrect && targetWord) {
      // Определяем, какое слово угадываем (всё слово/фразу)
      const wordToProcess = targetWord || this.word;
      
      // Вычисляем очки только за неотгаданные буквы в угадываемом слове
      const letters = wordToProcess.split('').filter(char => char !== ' '); // Игнорируем пробелы
      const letterPointsDetails = []; // Детали очков за каждую букву
      const uniqueNewLetters = new Set(); // Уникальные новые буквы, за которые начисляем очки
      let totalPoints = 0;
      
      // Подсчитываем количество неотгаданных букв в угадываемом слове
      let unguessedCount = 0;
      letters.forEach(letter => {
        const norm = this.normalizeChar(letter);
        if (!this.guessedLetters.has(norm)) {
          uniqueNewLetters.add(norm);
          unguessedCount++;
        }
      });
      
      // Генерируем очки для уникальных новых букв (с учетом количества вхождений в угадываемом слове)
      uniqueNewLetters.forEach(normLetter => {
        const basePoints = this.generatePoints();
        // Подсчитываем количество вхождений буквы только в угадываемом слове (по нормализованной форме)
        let letterCount = 0;
        for (const ch of wordToProcess.split('')) {
          if (ch === ' ') continue;
          if (this.normalizeChar(ch) === normLetter) letterCount++;
        }
        // Умножаем очки на количество вхождений
        const pointsForLetter = basePoints * letterCount;
        totalPoints += pointsForLetter;
        // Сохраняем базовые очки за эту букву (без умножения) для статистики
        // Если буква уже была угадана ранее, берем максимальное значение
        if (!this.letterPoints.has(normLetter) || this.letterPoints.get(normLetter) < basePoints) {
          this.letterPoints.set(normLetter, basePoints);
        }
        // Отмечаем букву как угаданную
        this.guessedLetters.add(normLetter);
      });
      
      // Формируем детальную статистику для уникальных букв угадываемого слова (в порядке первого появления)
      const seenLetters = new Set();
      letters.forEach(letter => {
        const norm = this.normalizeChar(letter);
        if (!seenLetters.has(norm)) {
          seenLetters.add(norm);
          // Подсчитываем количество вхождений буквы в угадываемом слове (нормализованно)
          let letterCount = 0;
          for (const ch of wordToProcess.split('')) {
            if (ch === ' ') continue;
            if (this.normalizeChar(ch) === norm) letterCount++;
          }

          if (uniqueNewLetters.has(norm)) {
            // Новая буква, за которую начислены очки
            const basePoints = this.letterPoints.get(norm);
            const totalPointsForLetter = basePoints * letterCount;
            letterPointsDetails.push({ 
              letter: norm, 
              basePoints: basePoints,
              letterCount: letterCount,
              totalPoints: totalPointsForLetter
            });
          } else {
            // Буква уже была угадана ранее
            const savedBasePoints = this.letterPoints.get(norm) || 0;
            const savedTotalPoints = savedBasePoints * letterCount;
            letterPointsDetails.push({ 
              letter: norm, 
              basePoints: savedBasePoints,
              letterCount: letterCount,
              totalPoints: savedTotalPoints,
              alreadyGuessed: true 
            });
          }
        }
      });

      // Добавляем 1/3 от суммы очков за неотгаданные буквы (бонус всегда начисляется при /guess)
      const bonus = Math.floor(totalPoints / 3);
      const finalPoints = totalPoints + bonus;
      
      const newTotal = this.addPoints(userId, finalPoints);

      // Формируем сообщение
      let message;
      if (wordCount === 1) {
        message = `🎉 Правильно! Слово "${this.word}" угадано!`;
      } else {
        message = `🎉 Правильно! Фраза "${this.word}" угадана!`;
      }

      return {
        success: true,
        message: message,
        points: finalPoints,
        basePoints: totalPoints,
        bonus: bonus,
        totalScore: newTotal,
        letterPointsDetails: letterPointsDetails,
        guessedWord: this.word
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
      const norm = this.normalizeChar(letter);
      if (!seenLetters.has(norm)) {
        seenLetters.add(norm);
        const basePoints = this.letterPoints.get(norm) || 0;
        // Подсчитываем количество вхождений буквы в слове (нормализованно)
        let letterCount = 0;
        for (const ch of this.word.split('')) {
          if (ch === ' ') continue;
          if (this.normalizeChar(ch) === norm) letterCount++;
        }
        const totalPoints = basePoints * letterCount;
        details.push({ 
          letter: norm, 
          basePoints: basePoints,
          letterCount: letterCount,
          totalPoints: totalPoints
        });
      }
    });
    
    return details;
  }

  // Получить список неверных букв (назывались, но не входят в слово)
  getWrongLetters() {
    const wrongLetters = [];
    const lettersInWord = new Set();
    
    // Собрать все буквы, которые есть в слове (нормализованные)
    for (const ch of this.word.split('')) {
      if (ch !== ' ') {
        lettersInWord.add(this.normalizeChar(ch));
      }
    }
    
    // Буквы, которые попытанные, но не в слове
    for (const letter of this.attemptedLetters) {
      if (!lettersInWord.has(letter)) {
        wrongLetters.push(letter);
      }
    }
    
    return wrongLetters.sort();
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
function formatLetterPointsDetails(game, skipBonus = false) {
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
  const bonus = skipBonus ? 0 : Math.floor(totalBase / 3);
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
    '/stats - Показать статистику чата\n' +
    '/history - Показать историю последних 10 игр\n' +
    '/guess <слово> - Угадать слово целиком\n' +
    '/end - Завершить игру (для ведущего)\n\n' +
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
  game.attemptedLetters.clear();
  game.scores.clear();
  game.letterPoints.clear();
  
  ctx.reply(
    '🎮 Новая игра начата!\n' +
    `👤 Ведущий: @${ctx.from.username || ctx.from.first_name}\n\n` +
    '🤵‍♂️ Информация для ведущего: используйте /word <слово> чтобы загадать слово.\n\n' +
    'Участникам необходимо дождаться, пока ведущий загадает слово.\n' +
    'После этого появится кнопка "Присоединиться" (к игре).\n\n' +
    '❗️ Первый, кто нажмёт кнопку, станет первым игроком в очереди.'
  );
});

// Функция для проверки и автодобавления последнего недостающего игрока
async function checkAndAddLastPlayer(chatId, ctx) {
  try {
    const game = getGame(chatId);
    const registeredPlayers = await db.getRegisteredPlayers(chatId);
    
    // Фильтруем зарегистрированных игроков (исключаем ведущего)
    const validRegisteredPlayers = registeredPlayers.filter(p => p.userId !== game.hostId);
    
    // Считаем, сколько игроков уже в игре
    const playersInGame = game.players.length;
    const totalValidPlayers = validRegisteredPlayers.length;
    
    console.log(`[${formatTime()}] checkAndAddLastPlayer: всего зарегистрировано ${totalValidPlayers}, в игре ${playersInGame}`);
    
    // Если не достаёт ровно одного игрока - добавляем его автоматически
    if (totalValidPlayers > 0 && (totalValidPlayers - playersInGame) === 1) {
      console.log(`[${formatTime()}] Условие выполнено: не хватает ровно одного игрока`);
      
      // Находим недостающего игрока
      const missingPlayer = validRegisteredPlayers.find(
        regPlayer => !game.players.find(p => p.id === regPlayer.userId)
      );
      
      console.log(`[${formatTime()}] Недостающий игрок: ${missingPlayer ? missingPlayer.username : 'не найден'}`);
      
      if (missingPlayer) {
        game.addPlayer(missingPlayer.userId, missingPlayer.username);
        console.log(`[${formatTime()}] ✅ Автоматически добавлен последний игрок: @${missingPlayer.username}`);
        
        if (ctx) {
          ctx.reply(
            `🤖 Автоматически добавлен последний игрок: @${missingPlayer.username}\n` +
            `👥 Всего игроков в игре: ${game.players.length}`
          );
        }
      }
    } else {
      console.log(`[${formatTime()}] Условие не выполнено: разница ${totalValidPlayers - playersInGame}`);
    }
  } catch (error) {
    console.error('Ошибка при проверке и добавлении последнего игрока:', error);
  }
}

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
  game.attemptedLetters.clear();
  game.currentPlayerIndex = -1; // -1 означает, что еще никто не начал ходить
  game.scores.clear(); // Сбрасываем очки при новом слове
  game.letterPoints.clear(); // Сбрасываем очки за буквы

  // Ведущий НЕ добавляется в список игроков

  const displayWord = game.getDisplayWord();
  
  ctx.reply(
    `🎯 Слово загадано!\n\n` +
    `📝 Слово: ${displayWord}\n\n` +
    `👥 Игроки: ${game.players.length}\n\n` +
    `💬 Участники, нажмите кнопку "Присоединиться" чтобы присоединиться к игре!`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👥 Присоединиться', callback_data: 'join' },
            { text: '❓ Помощь', callback_data: 'help' }
          ]
        ]
      }
    }
  );
});

// Команда /join - присоединиться к игре
bot.command('join', async (ctx) => {
  const game = getGame(ctx.chat.id);
  
  if (!game.isActive && !game.word) {
    return ctx.reply('❌ Игра еще не начата. Дождитесь, пока ведущий загадает слово.');
  }

  // Регистрируем игрока в БД
  try {
    await db.registerPlayer(
      ctx.chat.id, 
      ctx.chat.title || 'Личный чат',
      ctx.from.id, 
      ctx.from.username || ctx.from.first_name
    );
  } catch (error) {
    console.error('Ошибка при регистрации игрока:', error);
  }

  game.addPlayer(ctx.from.id, ctx.from.username || ctx.from.first_name);
  
  ctx.reply(
    `✅ @${ctx.from.username || ctx.from.first_name} присоединился к игре!\n` +
    `👥 Всего игроков: ${game.players.length}`
  );
  
  // Проверяем, нужно ли автоматически добавить последнего игрока
  await checkAndAddLastPlayer(ctx.chat.id, ctx);
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
      const position = idx + 1;
      const status = p.isActive ? '' : ' (выбыл)';
      return `${marker} #${position} @${p.username || 'игрок'}${status}`;
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

  // Список неверных букв
  const wrongLetters = game.getWrongLetters();
  const wrongLettersText = wrongLetters.length > 0
    ? wrongLetters.join(', ')
    : 'нет';

  ctx.reply(
    `📊 Статус игры:\n\n` +
    `📝 Слово: ${displayWord}\n\n` +
    `🎲 Текущий ход: @${currentPlayer?.username || 'неизвестно'}\n\n` +
    `👥 Очередь игроков (${game.players.length}):\n${playersList}\n\n` +
    `✅ Угаданные буквы: ${Array.from(game.guessedLetters).sort().join(', ') || 'нет'}\n` +
    `❌ Неверные буквы: ${wrongLettersText}\n\n` +
    `🏆 Таблица очков:\n${scoresList}`
  );
});

// Команда /stats - показать статистику чата из базы данных
bot.command('stats', async (ctx) => {
  try {
    const chatStats = await db.getChatStats(ctx.chat.id);
    
    if (!chatStats) {
      return ctx.reply('❌ В этом чате еще не было сыграно игр. Начните новую игру с /newgame');
    }

    // Сортируем всех игроков по очкам
    const allPlayers = [...chatStats.playerStats]
      .sort((a, b) => b.totalPoints - a.totalPoints);

    // Топ 10 для основного вывода
    const topPlayers = allPlayers.slice(0, 10);

    const statsText = topPlayers
      .map((p, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
        const winRate = p.gamesPlayed > 0 
          ? ((p.gamesWon / p.gamesPlayed) * 100).toFixed(1) 
          : '0.0';
        return `${medal} @${p.username}: ${p.totalPoints} очков (${p.gamesWon}/${p.gamesPlayed} побед, ${winRate}%)`;
      })
      .join('\n');

    // Полный рейтинг для тех, кто запросит подробнее
    const fullRating = allPlayers
      .map((p, idx) => {
        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}️⃣`;
        const winRate = p.gamesPlayed > 0 
          ? ((p.gamesWon / p.gamesPlayed) * 100).toFixed(1) 
          : '0.0';
        return `${medal} @${p.username}: ${p.totalPoints} очков | ${p.gamesWon}/${p.gamesPlayed} побед | ${winRate}%`;
      })
      .join('\n');

    const mainMessage = `📊 Статистика чата "${chatStats.chatTitle}":\n\n` +
      `📈 Всего игр: ${chatStats.totalGames}\n` +
      `👥 Всего игроков: ${allPlayers.length}\n\n` +
      `🏆 Топ 10 игроков:\n${statsText}`;

    ctx.reply(mainMessage);
  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    ctx.reply('❌ Ошибка при получении статистики.');
  }
});

// Команда /history - показать историю игр в чате
bot.command('history', async (ctx) => {
  try {
    const games = await db.getRecentGames(ctx.chat.id, 10);
    
    if (!games || games.length === 0) {
      return ctx.reply('❌ В этом чате еще не было сыграно игр. Начните новую игру с /newgame');
    }

    const historyText = games
      .map((game, idx) => {
        const date = new Date(game.createdAt);
        const dateStr = date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const playersList = game.players.map(p => `@${p.username}(${p.score})`).join(', ');
        const winner = game.winner ? `🏆 ${game.winner.username}(${game.winner.finalScore})` : '❓ Не завершена';
        
        return `${idx + 1}. "${game.word}" | ${playersList}\n   ${winner} | ${dateStr}`;
      })
      .join('\n\n');

    ctx.reply(
      `📜 История последних 10 игр в чате:\n\n${historyText}`
    );
  } catch (error) {
    console.error('Ошибка получения истории:', error);
    ctx.reply('❌ Ошибка при получении истории игр.');
  }
});

// Команда /guess - угадать слово целиком
bot.command('guess', async (ctx) => {
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

  // Если еще никто не ходил, устанавливаем первого активного игрока (того, кто присоединился первым)
  if (game.currentPlayerIndex === -1) {
    // Находим первого активного игрока
    const firstActivePlayer = game.players.findIndex(p => p.isActive);
    if (firstActivePlayer !== -1) {
      game.currentPlayerIndex = firstActivePlayer;
      // Проверяем, что первый ходящий - это тот же игрок
      if (game.players[firstActivePlayer].id !== ctx.from.id) {
        const currentPlayer = game.players[firstActivePlayer];
        const playerIndex = game.players.findIndex(p => p.id === ctx.from.id);
        const queuePosition = playerIndex !== -1 ? playerIndex + 1 : '?';
        return ctx.reply(`⏳ Первый ход должен сделать @${currentPlayer.username}!\n🔢 Вы в очереди на позиции ${queuePosition}`);
      }
    }
  } else {
    // Проверяем, что это ход текущего игрока
    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== ctx.from.id) {
      const playerIndex = game.players.findIndex(p => p.id === ctx.from.id);
      const queuePosition = playerIndex !== -1 ? playerIndex + 1 : '?';
      return ctx.reply(`⏳ Сейчас не ваш ход! Ход игрока @${currentPlayer?.username || 'неизвестно'}\n🔢 Вы в очереди на позиции ${queuePosition}`);
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
      
      // Сохраняем результат в БД
      try {
        console.log(`[${formatTime()}] 🔍 DEBUG: Сохраняем игру в БД (слово угадано)`);
        console.log('  game.players:', game.players);
        console.log('  game.players.length:', game.players.length);
        await db.saveGameResult(
          ctx.chat.id,
          ctx.chat.title || 'Личный чат',
          game,
          game.hostId,
          game.players.find(p => p.id === game.hostId)?.username || 'неизвестно'
        );
        console.log('✅ Игра успешно сохранена в БД');
      } catch (error) {
        console.error('❌ Ошибка сохранения результата:', error);
      }
      
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
    // Слово не угадано - исключаем игрока из очереди ходов
    const playerName = player.username;
    const playerScore = game.getPlayerScore(ctx.from.id) || 0;
    game.excludePlayerFromTurns(ctx.from.id);
    
    ctx.reply(`❌ ${result.message}\n\n` +
      `😞 @${playerName}, вы выбыли из игры!\n` +
      `💰 Вы набрали ${playerScore} очков`);
    
    // Проверяем, есть ли активные игроки
    const activePlayers = game.getActivePlayers();
    if (activePlayers.length > 0) {
      const nextPlayer = game.passTurnToNext();
      ctx.reply(
        `📝 Слово: ${game.getDisplayWord()}\n\n` +
        `🎲 Следующий ход: @${nextPlayer.username || 'неизвестно'}`
      );
    } else {
      // Все игроки выбыли - сохраняем результат и завершаем игру
      ctx.reply(
        `🎮 Все игроки выбыли! Игра завершена.\n` +
        `📝 Слово было: ${game.word}`
      );
      
      // Устанавливаем флаг, что нет победителя (все выбыли)
      game.hasWinner = false;
      
      // Сохраняем результат в БД
      try {
        console.log(`[${formatTime()}] 🔍 DEBUG: Сохраняем игру в БД (все игроки выбыли)`);
        console.log('  game.players:', game.players);
        await db.saveGameResult(
          ctx.chat.id,
          ctx.chat.title || 'Личный чат',
          game,
          game.hostId,
          game.players.find(p => p.id === game.hostId)?.username || 'неизвестно'
        );
        console.log('✅ Игра успешно сохранена в БД');
      } catch (error) {
        console.error('❌ Ошибка сохранения результата:', error);
      }
      
      game.isActive = false;
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
bot.command('end', async (ctx) => {
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
  
  // Детальная статистика очков за буквы (без бонуса при /end)
  const letterDetails = formatLetterPointsDetails(game, true);
  
  // Сохраняем результат в БД перед очисткой
  try {
    await db.saveGameResult(
      ctx.chat.id,
      ctx.chat.title || 'Личный чат',
      game,
      game.hostId,
      ctx.from.username || ctx.from.first_name
    );
  } catch (error) {
    console.error('Ошибка сохранения результата:', error);
  }
  
  game.isActive = false;
  game.word = '';
  game.players = [];
  game.currentPlayerIndex = -1;
  game.guessedLetters.clear();
  game.attemptedLetters.clear();
  game.scores.clear();
  game.letterPoints.clear();
  game.hostId = null;

  ctx.reply(`🏁 Игра завершена!\n📝 Загаданное слово было: ${word}${letterDetails}${finalScores}`);
});

// Обработка букв от участников
bot.command('try', async (ctx) => {
  const game = getGame(ctx.chat.id);

  // Проверяем, активна ли игра
  if (!game.isActive || !game.word) {
    return ctx.reply('❌ Игра еще не начата.');
  }

  // Проверяем, что это буква (одна буква)
  const parts = ctx.message.text.split(' ');
  if (!parts[1]) {
    return ctx.reply('❌ Укажите букву! Например: /try А');
  }
  const text = parts[1].trim();
  if (text.length !== 1) {
    return ctx.reply('❌ Это не одна буква!');
  }

  // Проверяем, что это буква
  if (!/^[А-Яа-яЁёA-Za-z]$/.test(text)) {
    return ctx.reply('❌ Это не буква!!!');
  }

  // Проверяем, что игрок участвует в игре
  let player = game.players.find(p => p.id === ctx.from.id);
  if (!player) {
    // Автоматически добавляем игрока, если его ещё нет
    game.addPlayer(ctx.from.id, ctx.from.username || ctx.from.first_name);
    player = game.players.find(p => p.id === ctx.from.id);
  }

  // Если еще никто не ходил, устанавливаем первого активного игрока (того, кто присоединился первым)
  if (game.currentPlayerIndex === -1) {
    // Находим первого активного игрока
    const firstActivePlayer = game.players.findIndex(p => p.isActive);
    if (firstActivePlayer !== -1) {
      game.currentPlayerIndex = firstActivePlayer;
      // Проверяем, что первый ходящий - это тот же игрок
      if (game.players[firstActivePlayer].id !== ctx.from.id) {
        const currentPlayer = game.players[firstActivePlayer];
        const playerIndex = game.players.findIndex(p => p.id === ctx.from.id);
        const queuePosition = playerIndex !== -1 ? playerIndex + 1 : '?';
        return ctx.reply(`⏳ Первый ход должен сделать @${currentPlayer.username}!\n🔢 Вы в очереди на позиции ${queuePosition}`);
      }
    }
  } else {
    // Проверяем, что это ход текущего игрока
    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== ctx.from.id) {
      const playerIndex = game.players.findIndex(p => p.id === ctx.from.id);
      const queuePosition = playerIndex !== -1 ? playerIndex + 1 : '?';
      return ctx.reply(`⏳ Сейчас не ваш ход! Ход игрока @${currentPlayer?.username || 'неизвестно'}\n🔢 Вы в очереди на позиции ${queuePosition}`);
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
      
      // Детальная статистика очков за буквы (без бонуса, так как это /try)
      const letterDetails = formatLetterPointsDetails(game, true);
      
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
      
      // Сохраняем результат в БД
      try {
        await db.saveGameResult(
          ctx.chat.id,
          ctx.chat.title || 'Личный чат',
          game,
          game.hostId,
          game.players.find(p => p.id === game.hostId)?.username || 'неизвестно'
        );
      } catch (error) {
        console.error('Ошибка сохранения результата:', error);
      }
      
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
    // Буква не угадана или уже называлась
    if (result.alreadyTried) {
      // Буква уже называлась - игрок называет букву еще раз, ход не передаётся
      ctx.reply(
        `⚠️ ${result.message}\n\n` +
        `📝 Слово: ${game.getDisplayWord()}\n\n` +
        `🎲 Попробуйте другую букву!`
      );
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
  }
});

// Обработка кнопок
bot.action('join', async (ctx) => {
  ctx.answerCbQuery();
  const game = getGame(ctx.chat.id);
  
  if (!game.isActive && !game.word) {
    return ctx.reply('❌ Игра еще не начата. Дождитесь, пока ведущий загадает слово.');
  }

  // Регистрируем игрока в БД
  try {
    await db.registerPlayer(
      ctx.chat.id, 
      ctx.chat.title || 'Личный чат',
      ctx.from.id, 
      ctx.from.username || ctx.from.first_name
    );
  } catch (error) {
    console.error('Ошибка при регистрации игрока:', error);
  }

  game.addPlayer(ctx.from.id, ctx.from.username || ctx.from.first_name);
  
  ctx.reply(
    `✅ @${ctx.from.username || ctx.from.first_name} присоединился к игре!\n` +
    `👥 Всего игроков: ${game.players.length}`
  );
  
  // Проверяем, нужно ли автоматически добавить последнего игрока
  await checkAndAddLastPlayer(ctx.chat.id, ctx);
});

bot.action('help', (ctx) => {
  ctx.answerCbQuery();
  ctx.reply(
    '📋 Полный список команд:\n\n' +
    '/newgame - Начать новую игру (для ведущего)\n' +
    '/word <слово> - Загадать слово (для ведущего)\n' +
    '/status - Показать текущее состояние игры\n' +
    '/stats - Показать статистику чата\n' +
    '/history - Показать историю последних 10 игр\n' +
    '/try <буква> - Угадать букву\n' +
    '/guess <слово> - Угадать слово целиком\n' +
    '/next - Передать ход следующему игроку\n' +
    '/end - Завершить игру (для ведущего)\n\n' +
    '💡 При правильном ответе ваш ход продолжается, при ошибке - ход переходит следующему.'
  );
});

bot.action('status', (ctx) => {
  ctx.answerCbQuery();
  const game = getGame(ctx.chat.id);
  
  if (!game.word) {
    return ctx.reply('❌ Игра еще не начата.');
  }

  const displayWord = game.getDisplayWord();
  const currentPlayer = game.getCurrentPlayer();
  const playersList = game.players
    .map((p, idx) => {
      const marker = idx === game.currentPlayerIndex ? '🎲' : '👤';
      const position = idx + 1;
      const status = p.isActive ? '' : ' (выбыл)';
      return `${marker} #${position} @${p.username || 'игрок'}${status}`;
    })
    .join('\n');

  const scoresTable = game.getScoresTable();
  const scoresList = scoresTable.length > 0
    ? scoresTable
        .map((p, idx) => {
          const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
          return `${medal} @${p.username}: ${p.score} очков`;
        })
        .join('\n')
    : 'Очки пока не начислены';

  const wrongLetters = game.getWrongLetters();
  const wrongLettersText = wrongLetters.length > 0
    ? wrongLetters.join(', ')
    : 'нет';

  ctx.reply(
    `📊 Статус игры:\n\n` +
    `📝 Слово: ${displayWord}\n\n` +
    `🎲 Текущий ход: @${currentPlayer?.username || 'неизвестно'}\n\n` +
    `👥 Очередь игроков (${game.players.length}):\n${playersList}\n\n` +
    `✅ Угаданные буквы: ${Array.from(game.guessedLetters).sort().join(', ') || 'нет'}\n` +
    `❌ Неверные буквы: ${wrongLettersText}\n\n` +
    `🏆 Таблица очков:\n${scoresList}`
  );
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}:`, err);
  ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.');
});

// Запуск бота
async function startBot() {
  try {
    await db.connect();
    await bot.launch();
    console.log('🤖 Бот запущен!');
  } catch (err) {
    console.error('Ошибка запуска бота:', err);
    process.exit(1);
  }
}

startBot();

// Graceful stop
process.once('SIGINT', async () => {
  console.log('Остановка бота...');
  await db.disconnect();
  bot.stop('SIGINT');
});

process.once('SIGTERM', async () => {
  console.log('Остановка бота...');
  await db.disconnect();
  bot.stop('SIGTERM');
});

