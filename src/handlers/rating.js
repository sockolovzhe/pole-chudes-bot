// Оценка сложности слова после завершения игры и рейтинг слов (/words)

const { displayName } = require('./shared');

const RATING_PROMPT_HINT = '1 — очень лёгкое, 5 — очень сложное';

function ratingKeyboard(gameResultId) {
  return {
    reply_markup: {
      inline_keyboard: [
        ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'].map((label, idx) => ({
          text: label,
          callback_data: `rate:${gameResultId}:${idx + 1}`,
        })),
      ],
    },
  };
}

// Предложить игрокам оценить сложность слова (после сохранения игры в БД)
async function sendRatingPrompt(ctx, gameResult) {
  if (!gameResult) return; // игра не сохранилась — оценивать нечего

  try {
    await ctx.reply(
      `⭐ Оцените сложность слова "${gameResult.word}"\n${RATING_PROMPT_HINT}`,
      ratingKeyboard(gameResult._id)
    );
  } catch (error) {
    console.error('Ошибка отправки запроса оценки:', error);
  }
}

function registerRatingHandlers(bot, { db }) {
  // Нажатие кнопки с оценкой
  bot.action(/^rate:([0-9a-f]{24}):([1-5])$/, async (ctx) => {
    try {
      const [, gameResultId, ratingStr] = ctx.match;
      const rating = Number(ratingStr);

      const result = await db.rateWord(gameResultId, ctx.from.id, displayName(ctx.from), rating);

      if (!result) {
        return ctx.answerCbQuery('❌ Игра не найдена');
      }
      if (result.notPlayer) {
        return ctx.answerCbQuery('❌ Оценивать могут только игроки этой партии');
      }

      await ctx.answerCbQuery(`Ваша оценка: ${rating}`);

      // Показываем текущую среднюю оценку в том же сообщении
      await ctx.editMessageText(
        `⭐ Оцените сложность слова "${result.word}"\n${RATING_PROMPT_HINT}\n\n` +
        `📊 Средняя оценка: ${result.average.toFixed(1)} (голосов: ${result.count})`,
        ratingKeyboard(gameResultId)
      ).catch(() => {}); // повторная одинаковая оценка не меняет текст — это не ошибка
    } catch (error) {
      console.error('Ошибка обработки оценки:', error);
      ctx.answerCbQuery('❌ Ошибка, попробуйте еще раз');
    }
  });

  // Рейтинг слов чата по сложности
  bot.command('words', async (ctx) => {
    try {
      const rating = await db.getWordDifficultyRating(ctx.chat.id, 10);

      if (rating.length === 0) {
        return ctx.reply('❌ Оценённых слов пока нет. Оценки можно ставить после завершения игры.');
      }

      const lines = rating
        .map((r, idx) => `${idx + 1}. "${r.word}" — ⭐ ${r.average.toFixed(1)} (голосов: ${r.votes})`)
        .join('\n');

      ctx.reply(`🧩 Рейтинг слов по сложности:\n${RATING_PROMPT_HINT}\n\n${lines}`);
    } catch (error) {
      console.error('Ошибка получения рейтинга слов:', error);
      ctx.reply('❌ Ошибка при получении рейтинга слов.');
    }
  });
}

module.exports = { sendRatingPrompt, registerRatingHandlers };
