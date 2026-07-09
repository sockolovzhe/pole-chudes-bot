// Ожидание текстового ввода после команды без аргумента (/try, /guess, /word).
// Бот отправляет ForceReply-подсказку, а ответ на неё обрабатывается как аргумент.

const pendingInputs = new Map(); // `${chatId}:${userId}` -> { type, promptMessageId }

function key(chatId, userId) {
  return `${chatId}:${userId}`;
}

// Отправить подсказку с ForceReply и запомнить ожидание (одно на игрока в чате).
// Работает и из команд (ctx.message), и из нажатий кнопок (ctx.callbackQuery)
async function askForInput(ctx, type, promptText, placeholder) {
  const sourceMessageId = ctx.message?.message_id ?? ctx.callbackQuery?.message?.message_id;
  const prompt = await ctx.reply(promptText, {
    reply_parameters: sourceMessageId ? { message_id: sourceMessageId } : undefined,
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: placeholder,
    },
  });

  pendingInputs.set(key(ctx.chat.id, ctx.from.id), { type, promptMessageId: prompt.message_id });
}

// Забрать ожидание, если пользователь ответил именно на подсказку бота
function takePendingInput(chatId, userId, repliedMessageId) {
  const entry = pendingInputs.get(key(chatId, userId));
  if (!entry || entry.promptMessageId !== repliedMessageId) return null;

  pendingInputs.delete(key(chatId, userId));
  return entry;
}

module.exports = { askForInput, takePendingInput };
