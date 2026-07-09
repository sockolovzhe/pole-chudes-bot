// Игровые команды: /join, /try, /guess, /next (и кнопка "Присоединиться")

const { getGame } = require('../games');
const { displayName } = require('./users');
const { handleJoin, ensurePlayersTurn } = require('./shared');
const { handleTry, handleGuess } = require('./actions');
const { askForInput } = require('./pending');

module.exports = (bot, { db }) => {
  bot.command('join', (ctx) => handleJoin(ctx, getGame(ctx.chat.id), db));

  bot.action('join', (ctx) => {
    ctx.answerCbQuery();
    return handleJoin(ctx, getGame(ctx.chat.id), db);
  });

  // Угадать букву
  bot.command('try', (ctx) => {
    const letter = ctx.message.text.split(' ')[1]?.trim();

    if (!letter) {
      // Команда из меню без аргумента — просим прислать букву ответом
      const game = getGame(ctx.chat.id);
      if (!game.isActive || !game.word) {
        return ctx.reply('❌ Игра еще не начата.');
      }
      return askForInput(
        ctx,
        'try',
        `✍️ @${displayName(ctx.from)}, ответьте на это сообщение одной буквой`,
        'Например: А'
      );
    }

    return handleTry(ctx, db, letter);
  });

  // Угадать слово целиком
  bot.command('guess', (ctx) => {
    const guessedWord = ctx.message.text.split(' ').slice(1).join(' ').trim();

    if (!guessedWord) {
      // Команда из меню без аргумента — просим прислать слово ответом
      const game = getGame(ctx.chat.id);
      if (!game.isActive || !game.word) {
        return ctx.reply('❌ Игра еще не начата.');
      }
      // Ведущему проверки участия и очереди не нужны (тестовый режим)
      if (ctx.from.id !== game.hostId) {
        if (!game.players.find(p => p.id === ctx.from.id)) {
          return ctx.reply('❌ Вы не участвуете в игре. Используйте /join чтобы присоединиться.');
        }
        if (!ensurePlayersTurn(ctx, game)) return;
      }
      return askForInput(
        ctx,
        'guess',
        `✍️ @${displayName(ctx.from)}, ответьте на это сообщение словом целиком`,
        'Например: ПРИМЕР'
      );
    }

    return handleGuess(ctx, db, guessedWord);
  });

  // Передать ход следующему игроку
  bot.command('next', (ctx) => {
    const game = getGame(ctx.chat.id);

    if (!game.isActive || !game.word) {
      return ctx.reply('❌ Игра еще не начата.');
    }

    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== ctx.from.id) {
      return ctx.reply(`⏳ Сейчас не ваш ход! Ход игрока @${currentPlayer?.username || 'неизвестно'}`);
    }

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
};
