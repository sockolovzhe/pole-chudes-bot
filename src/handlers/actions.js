// Игровые действия с текстовым аргументом: вызываются и из команд (/try А),
// и из ответов на ForceReply-подсказки, когда команда пришла без аргумента

const { getGame } = require('../games');
const { SINGLE_LETTER_REGEX, WORD_REGEX, HAS_LETTER_REGEX } = require('../letters');
const {
  formatFinalScores,
  formatLetterPointsDetails,
  formatLetterPointsMessage,
  formatGuessPointsMessage,
} = require('../format');
const { displayName } = require('./users');
const { registerPlayer, checkAndAddLastPlayer, ensurePlayersTurn, saveGameResult } = require('./shared');
const { sendRatingPrompt } = require('./rating');
const { askForInput } = require('./pending');
const { askForStartTime } = require('./schedule');

// Угадать букву
async function handleTry(ctx, db, letterInput) {
  const game = getGame(ctx.chat.id);

  if (!game.isActive || !game.word) {
    return ctx.reply('❌ Игра еще не начата.');
  }

  const letter = (letterInput || '').trim();
  if (!letter) {
    return ctx.reply('❌ Укажите букву! Например: /try А');
  }
  if (letter.length !== 1) {
    return ctx.reply('❌ Это не одна буква!');
  }
  if (!SINGLE_LETTER_REGEX.test(letter)) {
    return ctx.reply('❌ Это не буква!!!');
  }

  // Автоматически добавляем игрока, если его ещё нет
  if (!game.players.find(p => p.id === ctx.from.id)) {
    await registerPlayer(ctx, db, game);
    game.addPlayer(ctx.from.id, displayName(ctx.from));
    await checkAndAddLastPlayer(ctx, game, db);
  }

  if (!ensurePlayersTurn(ctx, game)) return;

  const result = game.guessLetter(letter, ctx.from.id);

  if (result.success) {
    if (result.isComplete) {
      // Угадана последняя буква — игра завершена
      ctx.reply(
        `🎉 Поздравляем! Игрок @${displayName(ctx.from)} угадал последнюю букву!\n\n` +
        `${formatLetterPointsMessage(result)}\n\n` +
        `🏆 Слово полностью угадано: ${game.word}${formatLetterPointsDetails(game, true)}${formatFinalScores(game)}\n\n` +
        `🎮 Игра завершена! Используйте /newgame для новой игры.`
      );

      const gameResult = await saveGameResult(ctx, game, db);
      game.isActive = false;
      await sendRatingPrompt(ctx, gameResult);
    } else {
      // Буква угадана — игрок продолжает ходить
      ctx.reply(
        `✅ ${result.message}\n\n` +
        `${formatLetterPointsMessage(result)}\n\n` +
        `📝 Слово: ${game.getDisplayWord()}\n\n` +
        `🎲 Ваш ход продолжается! Можете угадывать еще.`
      );
    }
  } else if (result.alreadyTried) {
    // Буква уже называлась — ход не передаётся
    ctx.reply(
      `⚠️ ${result.message}\n\n` +
      `📝 Слово: ${game.getDisplayWord()}\n\n` +
      `🎲 Попробуйте другую букву!`
    );
  } else {
    // Буквы нет в слове — ход переходит следующему игроку
    const nextPlayer = game.passTurnToNext();
    ctx.reply(
      `❌ ${result.message}\n\n` +
      `📝 Слово: ${game.getDisplayWord()}` +
      (nextPlayer ? `\n\n🎲 Следующий ход: @${nextPlayer.username || 'неизвестно'}` : '')
    );
  }
}

// Угадать слово целиком
async function handleGuess(ctx, db, wordInput) {
  const game = getGame(ctx.chat.id);

  if (!game.isActive || !game.word) {
    return ctx.reply('❌ Игра еще не начата.');
  }

  // Ведущий может проверять слово вне очереди (тестовый режим, без очков)
  const isHost = ctx.from.id === game.hostId;
  const player = game.players.find(p => p.id === ctx.from.id);

  if (!isHost) {
    if (!player) {
      return ctx.reply('❌ Вы не участвуете в игре. Используйте /join чтобы присоединиться.');
    }

    if (!ensurePlayersTurn(ctx, game)) return;
  }

  const guessedWord = (wordInput || '').trim();

  if (!guessedWord) {
    return ctx.reply('❌ Укажите слово! Например: /guess ПРИМЕР');
  }

  if (!WORD_REGEX.test(guessedWord)) {
    return ctx.reply('❌ Слово должно содержать только буквы, пробелы и тире!');
  }

  if (isHost) {
    return handleHostGuess(ctx, db, game, guessedWord);
  }

  const result = game.guessWord(guessedWord, ctx.from.id);

  if (result.success) {
    if (game.isComplete()) {
      // Все буквы открыты — игра завершена
      ctx.reply(
        `${result.message}\n\n` +
        `${formatGuessPointsMessage(result)}\n\n` +
        `🏆 Слово полностью угадано: ${game.word}${formatFinalScores(game)}\n\n` +
        `🎮 Игра завершена! Используйте /newgame для новой игры.`
      );

      const gameResult = await saveGameResult(ctx, game, db);
      game.isActive = false;
      await sendRatingPrompt(ctx, gameResult);
    } else {
      // Игрок продолжает ходить
      ctx.reply(
        `${result.message}\n\n` +
        `${formatGuessPointsMessage(result)}\n\n` +
        `📝 Слово: ${game.getDisplayWord()}\n\n` +
        `🎲 Ваш ход продолжается! Можете угадывать еще.`
      );
    }
    return;
  }

  // Слово не угадано — игрок выбывает из очереди ходов
  const playerScore = game.getPlayerScore(ctx.from.id);
  game.excludePlayerFromTurns(ctx.from.id);

  ctx.reply(
    `❌ ${result.message}\n\n` +
    `😞 @${player.username}, вы выбыли из игры!\n` +
    `💰 Вы набрали ${playerScore} очков`
  );

  if (game.getActivePlayers().length > 0) {
    const nextPlayer = game.passTurnToNext();
    ctx.reply(
      `📝 Слово: ${game.getDisplayWord()}\n\n` +
      `🎲 Следующий ход: @${nextPlayer.username || 'неизвестно'}`
    );
  } else {
    // Все игроки выбыли — игра завершается без победителя
    ctx.reply(
      `🎮 Все игроки выбыли! Игра завершена.\n` +
      `📝 Слово было: ${game.word}`
    );

    game.hasWinner = false;
    const gameResult = await saveGameResult(ctx, game, db);
    game.isActive = false;
    await sendRatingPrompt(ctx, gameResult);
  }
}

// /guess от ведущего: проверка слова без очков, очереди ходов и выбывания
async function handleHostGuess(ctx, db, game, guessedWord) {
  if (!game.checkWord(guessedWord)) {
    return ctx.reply(
      `❌ Неправильно! Это не то слово.\n` +
      `🤵 Проверка ведущего — очередь ходов не изменилась.`
    );
  }

  // Слово верное — раскрываем его и завершаем игру штатно
  game.revealAllLetters();

  ctx.reply(
    `🤵 Ведущий раскрыл слово: ${game.word}${formatFinalScores(game)}\n\n` +
    `🎮 Игра завершена! Используйте /newgame для новой игры.`
  );

  const gameResult = await saveGameResult(ctx, game, db);
  game.isActive = false;
  await sendRatingPrompt(ctx, gameResult);
}

// Загадать своё слово (только ведущий): слово сохраняется как черновик,
// дальше бот спрашивает текст вопроса, а затем время старта игры
function handleSetWord(ctx, wordInput) {
  const game = getGame(ctx.chat.id);

  if (!game.hostId) {
    return ctx.reply('❌ Сначала начните игру командой /newgame');
  }

  if (game.hostId !== ctx.from.id) {
    return ctx.reply('❌ Только ведущий может загадывать слово!');
  }

  const word = (wordInput || '').trim();

  if (!word) {
    return ctx.reply('❌ Укажите слово! Например: /word ПРИМЕР');
  }

  if (!WORD_REGEX.test(word) || !HAS_LETTER_REGEX.test(word)) {
    return ctx.reply('❌ Слово должно содержать только буквы, пробелы и тире!');
  }

  game.pendingRiddle = { word, riddleText: null, imageTheme: null, custom: true };

  return askForInput(
    ctx,
    'question',
    `📜 @${displayName(ctx.from)}, ответьте на это сообщение текстом вопроса к загаданному слову — ` +
    `игроки увидят его при старте игры. Или напишите «без вопроса»`,
    'Текст вопроса или «без вопроса»'
  );
}

// Текст вопроса к своему слову; дальше — тема для картинки
function handleSetQuestion(ctx, questionInput) {
  const game = getGame(ctx.chat.id);

  if (game.hostId !== ctx.from.id) {
    return ctx.reply('❌ Только ведущий может загадывать слово!');
  }

  if (!game.pendingRiddle?.custom) {
    return ctx.reply('❌ Загаданное слово не найдено. Начните заново: кнопка «✍️ Загадать своё слово»');
  }

  const question = (questionInput || '').trim();
  game.pendingRiddle.riddleText = /^(без вопроса|нет)$/i.test(question) ? null : question;

  return askForInput(
    ctx,
    'imagetheme',
    `🎨 @${displayName(ctx.from)}, ответьте темой для картинки к вопросу — что на ней изобразить ` +
    `(можно по-русски). Картинка придёт в чат при старте игры; следите, чтобы она не подсказывала ответ. ` +
    `Или напишите «без картинки»`,
    'Тема картинки или «без картинки»'
  );
}

// Тема картинки к своему слову; дальше — выбор времени старта
function handleSetImageTheme(ctx, themeInput) {
  const game = getGame(ctx.chat.id);

  if (game.hostId !== ctx.from.id) {
    return ctx.reply('❌ Только ведущий может загадывать слово!');
  }

  if (!game.pendingRiddle?.custom) {
    return ctx.reply('❌ Загаданное слово не найдено. Начните заново: кнопка «✍️ Загадать своё слово»');
  }

  const theme = (themeInput || '').trim();
  game.pendingRiddle.imageTheme = /^(без картинки|нет)$/i.test(theme) ? null : theme;

  return askForStartTime(ctx);
}

module.exports = { handleTry, handleGuess, handleSetWord, handleSetQuestion, handleSetImageTheme };
