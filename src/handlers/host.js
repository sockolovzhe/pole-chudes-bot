// Команды ведущего: /newgame, /generate, /word, /end

const { Input } = require('telegraf');
const { getGame } = require('../games');
const { JOIN_KEYBOARD, escapeMarkdownV2, formatWordAnnouncement, formatFinalScores, formatLetterPointsDetails } = require('../format');
const { displayName, saveGameResult } = require('./shared');
const { handleSetWord } = require('./actions');
const { askForInput } = require('./pending');

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
    const riddle = await riddleGenerator.generateDailyRiddle();
    game.pendingRiddle = riddle;

    // Загадка показана, но слово ещё не загадано — решает ведущий
    await ctx.reply(riddle.riddleText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Выбрать это слово', callback_data: 'riddle_accept' },
            { text: '🔄 Другое слово', callback_data: 'riddle_retry' }
          ]
        ]
      }
    });
  } catch (error) {
    console.error('Ошибка при генерации загадки:', error);
    await ctx.reply(
      '❌ Произошла ошибка при генерации загадки.\n' +
      '🤵‍♂️ Попробуйте /generate еще раз или загадайте слово вручную: /word <слово>'
    );
  }
}

// Ведущий принял сгенерированную загадку: загадываем слово и запускаем игру
async function acceptPendingRiddle(ctx, game, riddleGenerator) {
  const riddle = game.pendingRiddle;

  game.setWord(riddle.word); // заодно очищает pendingRiddle

  // Слово для ведущего под спойлером и объявление игры
  await ctx.reply(`/word ||${escapeMarkdownV2(riddle.word)}||`, { parse_mode: 'MarkdownV2' });
  await ctx.reply(formatWordAnnouncement(game), JOIN_KEYBOARD);

  // Картинка генерируется в фоне (до минуты) и не задерживает игру
  riddleGenerator.generateImage(riddle.imageTheme)
    .then(imageBuffer => {
      if (imageBuffer) {
        return ctx.replyWithPhoto(Input.fromBuffer(imageBuffer, 'riddle.jpg'), {
          caption: '🎨 Иллюстрация к загадке дня'
        });
      }
    })
    .catch(error => console.warn('Не удалось отправить картинку:', error.message));
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
      '🤵 Ведущий, загадайте слово:\n' +
      '🎲 /generate — сгенерировать загадку дня\n' +
      '✍️ /word <слово> — загадать своё слово',
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 Сгенерировать загадку', callback_data: 'generate' }]
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

  // Ведущий принимает сгенерированную загадку
  bot.action('riddle_accept', async (ctx) => {
    const game = getGame(ctx.chat.id);

    if (game.hostId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Только ведущий может выбирать слово');
    }
    if (!game.pendingRiddle) {
      return ctx.answerCbQuery('❌ Эта загадка уже не актуальна. Сгенерируйте новую: /generate');
    }

    ctx.answerCbQuery('Слово выбрано!');
    // Убираем кнопки с принятой загадки
    ctx.editMessageReplyMarkup(undefined).catch(() => {});

    await acceptPendingRiddle(ctx, game, riddleGenerator);
  });

  // Ведущий просит другое слово
  bot.action('riddle_retry', (ctx) => {
    const game = getGame(ctx.chat.id);

    if (game.hostId !== ctx.from.id) {
      return ctx.answerCbQuery('❌ Только ведущий может выбирать слово');
    }

    ctx.answerCbQuery();
    // Убираем кнопки с отклонённой загадки
    ctx.editMessageReplyMarkup(undefined).catch(() => {});

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
