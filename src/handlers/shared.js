const { formatTime } = require('../time');
const { escapeMarkdownV2 } = require('../format');

// Отображаемое имя пользователя Telegram
function displayName(from) {
  return from.username || from.first_name;
}

function chatTitle(chat) {
  return chat.title || 'Личный чат';
}

// Личное сообщение (MarkdownV2) отправителю; в личном чате с ботом — просто
// ответ туда же. false — личка закрыта (пользователь не открывал диалог с ботом)
async function dmSender(ctx, text) {
  if (ctx.chat.id === ctx.from.id) {
    await ctx.reply(text, { parse_mode: 'MarkdownV2' });
    return true;
  }

  try {
    await ctx.telegram.sendMessage(ctx.from.id, text, { parse_mode: 'MarkdownV2' });
    return true;
  } catch (error) {
    console.warn(`[${formatTime()}] ⚠ Личка @${displayName(ctx.from)} недоступна: ${error.message}`);
    return false;
  }
}

// Приписка, из какого чата сообщение (в личном чате с ботом не нужна)
function chatLine(ctx) {
  return ctx.chat.id === ctx.from.id ? '' : `\n_Игра в чате «${escapeMarkdownV2(chatTitle(ctx.chat))}»_`;
}

// Показать ведущему сгенерированное слово-кандидат ещё до принятия загадки.
// true — ведущий увидел слово; false — личка закрыта, показывать негде
async function sendWordPreviewToHost(ctx, word) {
  return dmSender(ctx, `🎲 Сгенерировано слово: ||${escapeMarkdownV2(word)}||${chatLine(ctx)}`);
}

// Отправить загаданное слово ведущему в личку, чтобы участники чата не могли
// подсмотреть его под спойлером. Если личка закрыта (ведущий не открывал диалог
// с ботом) — фолбэк на спойлер в чате, как раньше
async function sendWordToHost(ctx, word) {
  const spoiler = `🤫 Загаданное слово: ||${escapeMarkdownV2(word)}||`;

  if (await dmSender(ctx, `${spoiler}${chatLine(ctx)}`)) {
    if (ctx.chat.id !== ctx.from.id) {
      await ctx.reply('📩 Загаданное слово отправлено ведущему в личные сообщения.');
    }
    return;
  }

  await ctx.reply(spoiler, { parse_mode: 'MarkdownV2' });
  await ctx.reply(
    `⚠️ Не удалось отправить слово в личку — оно выше под спойлером, и открыть его может любой участник!\n` +
    `🤵 @${displayName(ctx.from)}, напишите боту /start в личных сообщениях — и в следующий раз слово не будет светиться в чате.`
  );
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
  displayName,
  chatTitle,
  sendWordPreviewToHost,
  sendWordToHost,
  registerPlayer,
  checkAndAddLastPlayer,
  handleJoin,
  ensurePlayersTurn,
  saveGameResult,
};
