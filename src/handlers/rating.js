// Оценка игры после завершения (три категории, шкала 1-10) и рейтинг слов (/words)

const { displayName } = require('./users');

// Категории оценок; ключ попадает в callback_data
const CATEGORIES = {
  d: { field: 'difficulty', title: '🧩 Сложность слова', hint: '1 — очень лёгкое, 10 — очень сложное' },
  q: { field: 'question', title: '📜 Интересность вопроса', hint: '1 — скучный, 10 — очень интересный' },
  p: { field: 'process', title: '🎲 Интересность отгадки', hint: '1 — скучная, 10 — захватывающая' },
};

const RATING_LABELS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function ratingKeyboard(gameResultId, catKey) {
  const buttons = RATING_LABELS.map((label, idx) => ({
    text: label,
    callback_data: `rate:${gameResultId}:${catKey}:${idx + 1}`,
  }));
  // Две строки по пять кнопок (Telegram ограничивает ширину строки)
  return {
    reply_markup: {
      inline_keyboard: [buttons.slice(0, 5), buttons.slice(5)],
    },
  };
}

function promptText(cat, word) {
  return `${cat.title} — "${word}"\n${cat.hint}`;
}

// Предложить игрокам оценить игру по трём категориям (после сохранения в БД)
async function sendRatingPrompt(ctx, gameResult) {
  if (!gameResult) return; // игра не сохранилась — оценивать нечего

  try {
    for (const [catKey, cat] of Object.entries(CATEGORIES)) {
      await ctx.reply(promptText(cat, gameResult.word), ratingKeyboard(gameResult._id, catKey));
    }
  } catch (error) {
    console.error('Ошибка отправки запроса оценки:', error);
  }
}

// Обработать голос: сохранить и показать среднюю по категории в том же сообщении
async function handleRate(ctx, db, gameResultId, catKey, rating) {
  try {
    const cat = CATEGORIES[catKey];
    const result = await db.rateWord(gameResultId, ctx.from.id, displayName(ctx.from), cat.field, rating);

    if (!result) {
      return ctx.answerCbQuery('❌ Игра не найдена');
    }
    if (result.notPlayer) {
      return ctx.answerCbQuery('❌ Оценивать могут только игроки этой партии');
    }

    await ctx.answerCbQuery(`Ваша оценка: ${rating}`);

    await ctx.editMessageText(
      `${promptText(cat, result.word)}\n\n` +
      `📊 Средняя оценка: ${result.average.toFixed(1)} (голосов: ${result.count})`,
      ratingKeyboard(gameResultId, catKey)
    ).catch(() => {}); // повторная одинаковая оценка не меняет текст — это не ошибка
  } catch (error) {
    console.error('Ошибка обработки оценки:', error);
    ctx.answerCbQuery('❌ Ошибка, попробуйте еще раз');
  }
}

function registerRatingHandlers(bot, { db }) {
  // Нажатие кнопки с оценкой (категория + значение 1-10)
  bot.action(/^rate:([0-9a-f]{24}):([dqp]):([1-9]|10)$/, (ctx) => {
    const [, gameResultId, catKey, ratingStr] = ctx.match;
    return handleRate(ctx, db, gameResultId, catKey, Number(ratingStr));
  });

  // Рейтинг слов чата по оценкам игроков
  bot.command('words', async (ctx) => {
    try {
      const rating = await db.getWordRatings(ctx.chat.id, 10);

      if (rating.length === 0) {
        return ctx.reply('❌ Оценённых слов пока нет. Оценки можно ставить после завершения игры.');
      }

      const lines = rating
        .map((r, idx) => {
          const parts = [];
          if (r.difficulty != null) parts.push(`🧩 ${r.difficulty.toFixed(1)}`);
          if (r.question != null) parts.push(`📜 ${r.question.toFixed(1)}`);
          if (r.process != null) parts.push(`🎲 ${r.process.toFixed(1)}`);
          return `${idx + 1}. "${r.word}" — ${parts.join(' | ')} (голосов: ${r.votes})`;
        })
        .join('\n');

      ctx.reply(
        `🏅 Рейтинг слов по оценкам игроков (1–10):\n` +
        `🧩 сложность слова | 📜 интересность вопроса | 🎲 интересность отгадки\n\n${lines}`
      );
    } catch (error) {
      console.error('Ошибка получения рейтинга слов:', error);
      ctx.reply('❌ Ошибка при получении рейтинга слов.');
    }
  });
}

module.exports = { sendRatingPrompt, registerRatingHandlers };
