// Общий игровой поток: регистрация и присоединение игроков, очередь ходов,
// сохранение результатов

const { formatTime } = require('../time');
const { displayName, chatTitle, mentionHtml } = require('./users');

// Если все зарегистрированные игроки чата уже в игре — объявить, кто ходит
// первым, с настоящим упоминанием. Объявляется один раз за раунд
async function announceFirstTurnIfReady(ctx, game, db) {
  if (!game.isActive || game.firstTurnAnnounced || game.currentPlayerIndex !== -1) return;

  const firstPlayer = game.players.find(p => p.isActive);
  if (!firstPlayer) return;

  try {
    const registered = await db.getRegisteredPlayers(ctx.chat.id);
    const expected = registered.filter(p => p.userId !== game.hostId);
    // Список игроков чата пуст или собрались ещё не все — ждём
    if (expected.length === 0 || game.players.length < expected.length) return;

    game.firstTurnAnnounced = true;
    await ctx.reply(
      `🎉 Все игроки в сборе!\n🎲 Первым ходит ${mentionHtml(firstPlayer)} — угадывайте букву!`,
      { parse_mode: 'HTML' }
    );
  } catch (error) {
    console.error('Ошибка объявления первого хода:', error);
  }
}

// Зарегистрировать игрока в БД (ошибка не прерывает игру; в тестовом режиме БД не трогаем)
async function registerPlayer(ctx, db, game) {
  if (game?.isTestMode) return;

  try {
    await db.registerPlayer(ctx.chat.id, chatTitle(ctx.chat), ctx.from.id, displayName(ctx.from));
  } catch (error) {
    console.error('Ошибка при регистрации игрока:', error);
  }
}

// Если из зарегистрированных в чате игроков не хватает ровно одного — добавить его автоматически
async function checkAndAddLastPlayer(ctx, game, db) {
  try {
    const registeredPlayers = await db.getRegisteredPlayers(ctx.chat.id);
    const validRegistered = registeredPlayers.filter(p => p.userId !== game.hostId);

    if (validRegistered.length > 0 && validRegistered.length - game.players.length === 1) {
      const missingPlayer = validRegistered.find(
        regPlayer => !game.players.find(p => p.id === regPlayer.userId)
      );

      if (missingPlayer) {
        game.addPlayer(missingPlayer.userId, missingPlayer.username);
        console.log(`[${formatTime()}] ✅ Автоматически добавлен последний игрок: @${missingPlayer.username}`);
        ctx.reply(
          `🤖 Автоматически добавлен последний игрок: @${missingPlayer.username}\n` +
          `👥 Всего игроков в игре: ${game.players.length}`
        );
      }
    }
  } catch (error) {
    console.error('Ошибка при проверке и добавлении последнего игрока:', error);
  }
}

// Присоединить игрока к игре (общий код команды /join и кнопки)
async function handleJoin(ctx, game, db) {
  if (!game.isActive && !game.word) {
    return ctx.reply('❌ Игра еще не начата. Дождитесь, пока ведущий загадает слово.');
  }

  await registerPlayer(ctx, db, game);
  game.addPlayer(ctx.from.id, displayName(ctx.from));

  ctx.reply(
    `✅ @${displayName(ctx.from)} присоединился к игре!\n` +
    `👥 Всего игроков: ${game.players.length}`
  );

  await checkAndAddLastPlayer(ctx, game, db);
  await announceFirstTurnIfReady(ctx, game, db);
}

// Проверить, что сейчас ход игрока; если нет — ответить и вернуть false.
// Если ещё никто не ходил, первым ходит игрок, присоединившийся первым.
function ensurePlayersTurn(ctx, game) {
  if (game.currentPlayerIndex === -1) {
    const firstActiveIndex = game.players.findIndex(p => p.isActive);
    if (firstActiveIndex === -1) return true;

    game.currentPlayerIndex = firstActiveIndex;
    if (game.players[firstActiveIndex].id !== ctx.from.id) {
      const currentPlayer = game.players[firstActiveIndex];
      ctx.reply(
        `⏳ Первый ход должен сделать @${currentPlayer.username}!\n` +
        `🔢 Вы в очереди на позиции ${queuePosition(game, ctx.from.id)}`
      );
      return false;
    }
    return true;
  }

  const currentPlayer = game.getCurrentPlayer();
  if (!currentPlayer || currentPlayer.id !== ctx.from.id) {
    ctx.reply(
      `⏳ Сейчас не ваш ход! Ход игрока @${currentPlayer?.username || 'неизвестно'}\n` +
      `🔢 Вы в очереди на позиции ${queuePosition(game, ctx.from.id)}`
    );
    return false;
  }
  return true;
}

function queuePosition(game, userId) {
  const playerIndex = game.players.findIndex(p => p.id === userId);
  return playerIndex !== -1 ? playerIndex + 1 : '?';
}

// Сохранить результат игры в БД; вернуть сохранённый документ (или null при ошибке).
// В тестовом режиме ничего не сохраняется — статистика и очки не засоряются
async function saveGameResult(ctx, game, db, hostUsername = null) {
  if (game.isTestMode) {
    ctx.reply('🧪 Тестовый режим: результат игры не сохранён в статистику.');
    return null;
  }

  try {
    return await db.saveGameResult(
      ctx.chat.id,
      chatTitle(ctx.chat),
      game,
      game.hostId,
      hostUsername || game.players.find(p => p.id === game.hostId)?.username || 'неизвестно'
    );
  } catch (error) {
    console.error('Ошибка сохранения результата:', error);
    return null;
  }
}

module.exports = {
  announceFirstTurnIfReady,
  registerPlayer,
  checkAndAddLastPlayer,
  handleJoin,
  ensurePlayersTurn,
  saveGameResult,
};
