// Отложенный старт игры: ведущий выбирает время по Екатеринбургу,
// когда загадка будет отправлена в чат и начнётся игра

const { Input } = require('telegraf');
const { getGame } = require('../games');
const { JOIN_KEYBOARD, formatWordAnnouncement } = require('../format');
const { formatClock, formatTime, isSameEkbDay, parseScheduleTime } = require('../time');
const { sendWordToHost } = require('./shared');

// Загадать слово из принятой загадки и объявить игру (используется и при
// немедленном, и при отложенном старте)
async function startRiddleGame(ctx, game, riddle, riddleGenerator) {
  game.setWord(riddle.word);
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

// Ответ ведущего с временем старта: планируем публикацию загадки и начало игры
async function handleScheduleStart(ctx, input, riddleGenerator) {
  const game = getGame(ctx.chat.id);

  if (game.hostId !== ctx.from.id) {
    return ctx.reply('❌ Только ведущий может откладывать старт игры!');
  }

  const riddle = game.pendingRiddle;
  if (!riddle) {
    return ctx.reply('❌ Нет загадки для отложенного старта. Сгенерируйте новую: /generate');
  }

  // «Сейчас» — начать игру немедленно, без планирования
  if (/^сейчас$/i.test(input.trim())) {
    game.pendingRiddle = null;
    game.cancelScheduledStart();
    await sendWordToHost(ctx, riddle.word);
    return startRiddleGame(ctx, game, riddle, riddleGenerator);
  }

  const startAt = parseScheduleTime(input);
  if (!startAt) {
    return ctx.reply('❌ Не понял время. Укажите его в формате ЧЧ:ММ (по Екатеринбургу), например 18:30, или напишите «сейчас»');
  }

  game.pendingRiddle = null;
  game.cancelScheduledStart();

  const timer = setTimeout(async () => {
    // Пока ждали, старт могли отменить, а игру — сбросить или начать вручную
    if (game.scheduledStart?.timer !== timer) return;
    game.scheduledStart = null;

    try {
      await ctx.reply(`⏰ Время пришло! Загадка дня:\n\n${riddle.riddleText}`);
      await startRiddleGame(ctx, game, riddle, riddleGenerator);
      console.log(`[${formatTime()}] ⏰ Отложенная игра начата в чате ${ctx.chat.id}`);
    } catch (error) {
      console.error('Ошибка отложенного старта игры:', error);
    }
  }, startAt.getTime() - Date.now());

  game.scheduledStart = { riddle, startAt, timer };

  // Слово — ведущему в личку, чтобы подготовиться заранее
  await sendWordToHost(ctx, riddle.word);

  const dayNote = isSameEkbDay(startAt, new Date()) ? 'сегодня' : 'завтра';
  await ctx.reply(
    `⏰ Игра начнётся ${dayNote} в ${formatClock(startAt)} по Екатеринбургу.\n` +
    `📤 В это время загадка будет отправлена в чат, и игроки смогут присоединиться.\n` +
    `🚫 Отменить отложенный старт: /cancelstart`
  );
}

// Команда /cancelstart: отменить запланированный старт
function handleCancelStart(ctx) {
  const game = getGame(ctx.chat.id);

  if (!game.scheduledStart) {
    return ctx.reply('❌ Отложенный старт не запланирован.');
  }

  if (game.hostId !== ctx.from.id) {
    return ctx.reply('❌ Только ведущий может отменить отложенный старт!');
  }

  // Загадка возвращается на утверждение — её можно принять, заменить или отложить снова
  const { riddle } = game.scheduledStart;
  game.cancelScheduledStart();
  game.pendingRiddle = riddle;

  return ctx.reply('🚫 Отложенный старт отменён. Что делаем с загадкой?\n\n' + riddle.riddleText, {
    reply_markup: RIDDLE_CONFIRM_KEYBOARD,
  });
}

// Кнопки под сгенерированной загадкой (утверждение ведущим).
// Выбор слова всегда идёт через выбор времени старта («сейчас» — начать сразу)
const RIDDLE_CONFIRM_KEYBOARD = {
  inline_keyboard: [
    [{ text: '⏰ Выбрать и отложить старт', callback_data: 'riddle_schedule' }],
    [{ text: '🔄 Другое слово', callback_data: 'riddle_retry' }]
  ]
};

module.exports = { startRiddleGame, handleScheduleStart, handleCancelStart, RIDDLE_CONFIRM_KEYBOARD };
