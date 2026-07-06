// Обработка ответов на ForceReply-подсказки: текст ответа становится
// аргументом команды, после которой была отправлена подсказка

const { message } = require('telegraf/filters');
const { takePendingInput } = require('./pending');
const { handleTry, handleGuess, handleSetWord } = require('./actions');

module.exports = (bot, { db }) => {
  bot.on(message('text'), (ctx, next) => {
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo) return next();

    const entry = takePendingInput(ctx.chat.id, ctx.from.id, replyTo.message_id);
    if (!entry) return next();

    const input = ctx.message.text;
    switch (entry.type) {
      case 'try':
        return handleTry(ctx, db, input);
      case 'guess':
        return handleGuess(ctx, db, input);
      case 'word':
        return handleSetWord(ctx, input);
      default:
        return next();
    }
  });
};
