// Отложенный старт игры: ведущий выбирает время по Екатеринбургу,
// когда загадка будет отправлена в чат и начнётся игра

const { Input } = require('telegraf');
const { getGame } = require('../games');
const { JOIN_KEYBOARD, formatWordAnnouncement } = require('../format');
const { formatClock, formatTime, isSameEkbDay, parseScheduleTime } = require('../time');
const { displayName, sendWordToHost } = require('./shared');
const { askForInput } = require('./pending');

// Спросить у ведущего время старта игры (ответом на это сообщение)
function askForStartTime(ctx, prefix = '') {
  return askForInput(
    ctx,
    'schedule',
    `${prefix}⏰ @${displayName(ctx.from)}, ответьте на это сообщение временем старта игры ` +
    `в формате ЧЧ:ММ по Екатеринбургу (например 18:30) — или словом «сейчас», чтобы начать сразу`,
    'ЧЧ:ММ или «сейчас»'
  );
}

// Загадать слово из принятой загадки и объявить игру (используется и при
// немедленном, и при отложенном старте)
async function startRiddleGame(ctx, game, riddle, riddleGenerator) {
  game.setWord(riddle.word);
  await ctx.reply(formatWordAnnouncement(game), JOIN_KEYBOARD);

  // Картинка (если задана тема) создаётся в фоне до минуты и не задерживает игру
  if (!riddle.imageTheme) return;
  riddleGenerator.generateImage(riddle.imageTheme)
    .then(imageBuffer => {
      if (imageBuffer) {
        return ctx.replyWithPhoto(Input.fromBuffer(imageBuffer, 'riddle.jpg'), {
          caption: riddle.custom ? '🎨 Иллюстрация к вопросу' : '🎨 Иллюстрация к загадке дня'
        });
      }
    })
    .catch(error => console.warn('Не удалось отправить картинку:', error.message));
}

// Сообщение, открывающее игру: вопрос ведущего или сгенерированная загадка
function startAnnouncement(riddle, withTimePrefix) {
  const prefix = withTimePrefix ? '⏰ Время пришло! ' : '';
  if (!riddle.riddleText) return `${prefix}🎮 Начинаем игру!`;
  return `${prefix}${riddle.custom ? '📜 Вопрос от ведущего' : '🎩 Загадка дня'}:\n\n${riddle.riddleText}`;
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
    // Своё слово ведущий вводил сам — дублировать его в личку незачем;
    // его вопрос ещё не публиковался, поэтому отправляем сейчас
    if (riddle.custom) {
      if (riddle.riddleText) await ctx.reply(startAnnouncement(riddle, false));
    } else {
      await sendWordToHost(ctx, riddle.word);
    }
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
      await ctx.reply(startAnnouncement(riddle, true));
      await startRiddleGame(ctx, game, riddle, riddleGenerator);
      console.log(`[${formatTime()}] ⏰ Отложенная игра начата в чате ${ctx.chat.id}`);
    } catch (error) {
      console.error('Ошибка отложенного старта игры:', error);
    }
  }, startAt.getTime() - Date.now());

  game.scheduledStart = { riddle, startAt, timer };

  // Сгенерированное слово — ведущему в личку, чтобы подготовиться заранее
  // (своё слово он вводил сам)
  if (!riddle.custom) {
    await sendWordToHost(ctx, riddle.word);
  }

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

  // Загадка возвращается на утверждение — её можно запустить заново или заменить
  const { riddle } = game.scheduledStart;
  game.cancelScheduledStart();
  game.pendingRiddle = riddle;

  // Для своего слова перегенерация не нужна — просто спрашиваем новое время
  if (riddle.custom) {
    return askForStartTime(ctx, '🚫 Отложенный старт отменён.\n');
  }

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

module.exports = { askForStartTime, startRiddleGame, handleScheduleStart, handleCancelStart, RIDDLE_CONFIRM_KEYBOARD };
