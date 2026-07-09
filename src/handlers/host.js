// Команды ведущего: /newgame, /generate, /word, /end

const { getGame } = require('../games');
const { formatFinalScores, formatLetterPointsDetails } = require('../format');
const { displayName, sendWordPreviewToHost, saveGameResult } = require('./shared');
const { handleSetWord } = require('./actions');
const { askForInput } = require('./pending');
const { askForStartTime, handleCancelStart, RIDDLE_CONFIRM_KEYBOARD } = require('./schedule');

// Сгенерировать загадку и показать её ведущему на утверждение (команда /generate и кнопки)
async function handleGenerate(ctx, game, riddleGenerator) {
  if (!game.hostId) {
    return ctx.reply('❌ Сначала начните игру командой /newgame');
  }

  if (game.hostId !== ctx.from.id) {
    return ctx.reply('❌ Только ведущий может генерировать загадку!');
  }

  await ctx.reply('⏳ Генерирую загадку дня...');

  try {
    const riddle = await riddleGenerator.generateDailyRiddle(game.rejectedWords);
    game.pendingRiddle = riddle;

    // Слово-кандидат — ведущему в личку, чтобы он решал, видя ответ
    const wordShown = await sendWordPreviewToHost(ctx, riddle.word);

    // Загадка показана, но слово ещё не загадано — решает ведущий
    await ctx.reply(riddle.riddleText, { reply_markup: RIDDLE_CONFIRM_KEYBOARD });

    if (!wordShown) {
      await ctx.reply(
        `💡 @${displayName(ctx.from)}, чтобы видеть загаданное слово ещё до принятия загадки, ` +
        `откройте личный чат с ботом и отправьте /start`
      );
    }
  } catch (error) {
    console.error('Ошибка при генерации загадки:', error);
    await ctx.reply(
      '❌ Произошла ошибка при генерации загадки.\n' +
      '🤵‍♂️ Попробуйте /generate еще раз или загадайте слово вручную: /word <слово>'
    );
  }
}

module.exports = (bot, { db, riddleGenerator }) => {
  // Начать новую игру: ведущий сам выбирает, генерировать слово или загадать своё
  bot.command('newgame', (ctx) => {
    const game = getGame(ctx.chat.id);
    game.reset();
    game.players = [];
    game.hostId = ctx.from.id;

    ctx.reply(
      '🎮 Новая игра начата!\n' +
      `👤 Ведущий: @${displayName(ctx.from)}\n\n` +
      '🤵 Ведущий, загадайте слово:',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 Сгенерировать загадку', callback_data: 'generate' }],
            [{ text: '✍️ Загадать своё слово', callback_data: 'word_manual' }]
          ]
        }
      }
    );
  });

  // Сгенерировать загадку дня
  bot.command('generate', (ctx) => handleGenerate(ctx, getGame(ctx.chat.id), riddleGenerator));

  bot.action('generate', (ctx) => {
    ctx.answerCbQuery();
    return handleGenerate(ctx, getGame(ctx.chat.id), riddleGenerator);
  });

  // Ведущий загадывает своё слово кнопкой: просим прислать его ответом
  bot.action('word_manual', (ctx) => {
    const game = getGame(ctx.chat.id);

    if (!game.hostId) {
      return ctx.answerCbQuery('❌ Сначала начните игру командой /newgame');
    }
    if (game.hostId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Только ведущий может загадывать слово');
    }

    ctx.answerCbQuery();
    return askForInput(
      ctx,
      'word',
      `✍️ @${displayName(ctx.from)}, ответьте на это сообщение словом, которое хотите загадать`,
      'Слово или фраза'
    );
  });

  // Ведущий выбирает слово и откладывает старт: спрашиваем время (по Екатеринбургу)
  bot.action('riddle_schedule', (ctx) => {
    const game = getGame(ctx.chat.id);

    if (game.hostId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Только ведущий может выбирать слово');
    }
    if (!game.pendingRiddle) {
      return ctx.answerCbQuery('❌ Эта загадка уже не актуальна. Сгенерируйте новую: /generate');
    }

    ctx.answerCbQuery();
    // Убираем кнопки с загадки, ждём время ответом на подсказку
    ctx.editMessageReplyMarkup(undefined).catch(() => {});

    return askForStartTime(ctx);
  });

  // Отменить отложенный старт
  bot.command('cancelstart', handleCancelStart);

  // Ведущий просит другое слово
  bot.action('riddle_retry', (ctx) => {
    const game = getGame(ctx.chat.id);

    if (game.hostId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Только ведущий может выбирать слово');
    }

    ctx.answerCbQuery();
    // Убираем кнопки с отклонённой загадки
    ctx.editMessageReplyMarkup(undefined).catch(() => {});

    // Запоминаем отклонённое слово, чтобы генерация не предлагала его снова
    if (game.pendingRiddle?.word) {
      game.rejectedWords.push(game.pendingRiddle.word);
    }

    return handleGenerate(ctx, game, riddleGenerator);
  });

  // Загадать слово вручную
  bot.command('word', (ctx) => {
    const word = ctx.message.text.split(' ').slice(1).join(' ').trim();

    if (!word) {
      // Команда из меню без аргумента — просим прислать слово ответом
      const game = getGame(ctx.chat.id);
      if (!game.hostId) {
        return ctx.reply('❌ Сначала начните игру командой /newgame');
      }
      if (game.hostId !== ctx.from.id) {
        return ctx.reply('❌ Только ведущий может загадывать слово!');
      }
      return askForInput(
        ctx,
        'word',
        `✍️ @${displayName(ctx.from)}, ответьте на это сообщение словом, которое хотите загадать`,
        'Слово или фраза'
      );
    }

    return handleSetWord(ctx, word);
  });

  // Завершить игру досрочно
  bot.command('end', async (ctx) => {
    const game = getGame(ctx.chat.id);

    if (!game.hostId) {
      return ctx.reply('❌ Игра не начата.');
    }

    if (game.hostId !== ctx.from.id) {
      return ctx.reply('❌ Только ведущий может завершить игру!');
    }

    const word = game.word || 'не загадано';
    const finalScores = formatFinalScores(game);
    const letterDetails = formatLetterPointsDetails(game, true);

    await saveGameResult(ctx, game, db, displayName(ctx.from));

    game.reset();
    game.players = [];
    game.hostId = null;

    ctx.reply(`🏁 Игра завершена!\n📝 Загаданное слово было: ${word}${letterDetails}${finalScores}`);
  });
};
