// Команды ведущего: /newgame, /word, /end

const { getGame } = require('../games');
const { JOIN_KEYBOARD, escapeMarkdownV2, formatWordAnnouncement, formatFinalScores, formatLetterPointsDetails } = require('../format');
const { displayName, saveGameResult } = require('./shared');
const { handleSetWord } = require('./actions');
const { askForInput } = require('./pending');

module.exports = (bot, { db, riddleGenerator }) => {
  // Начать новую игру с автоматической генерацией загадки
  bot.command('newgame', async (ctx) => {
    const game = getGame(ctx.chat.id);
    game.reset();
    game.players = [];
    game.hostId = ctx.from.id;

    await ctx.reply(
      '🎮 Новая игра начата!\n' +
      `👤 Ведущий: @${displayName(ctx.from)}\n\n` +
      '⏳ Генерирую загадку дня...'
    );

    try {
      const riddle = await riddleGenerator.generateDailyRiddle();

      try {
        await ctx.replyWithPhoto(riddle.imageUrl, { caption: riddle.riddleText });
      } catch (photoError) {
        console.log('Не удалось загрузить изображение, отправляем текст:', photoError.message);
        await ctx.reply(riddle.riddleText);
      }

      game.setWord(riddle.word);

      // Слово для ведущего под спойлером и объявление игры
      setTimeout(async () => {
        await ctx.reply(`/word ||${escapeMarkdownV2(riddle.word)}||`, { parse_mode: 'MarkdownV2' });
        await ctx.reply(formatWordAnnouncement(game), JOIN_KEYBOARD);
      }, 1000);
    } catch (error) {
      console.error('Ошибка при генерации загадки:', error);
      await ctx.reply(
        '❌ Произошла ошибка при генерации загадки.\n' +
        '🤵‍♂️ Информация для ведущего: используйте /word <слово> чтобы загадать слово вручную.'
      );
    }
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
