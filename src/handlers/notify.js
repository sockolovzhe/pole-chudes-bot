// Личные сообщения ведущему: загаданное слово не должно светиться в чате

const { formatTime } = require('../time');
const { escapeMarkdownV2 } = require('../format');
const { displayName, chatTitle } = require('./users');

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

module.exports = { sendWordPreviewToHost, sendWordToHost };
