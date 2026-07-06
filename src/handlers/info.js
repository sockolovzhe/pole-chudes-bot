// Информационные команды: /start, /status, /stats, /history (и кнопки "Статус", "Помощь")

const { getGame } = require('../games');
const { START_TEXT, HELP_TEXT, medal, formatStatus } = require('../format');

function showStatus(ctx) {
  const game = getGame(ctx.chat.id);

  if (!game.word) {
    return ctx.reply('❌ Игра еще не начата.');
  }

  ctx.reply(formatStatus(game));
}

module.exports = (bot, { db }) => {
  bot.command('start', (ctx) => ctx.reply(START_TEXT));

  bot.command('status', showStatus);

  bot.action('status', (ctx) => {
    ctx.answerCbQuery();
    return showStatus(ctx);
  });

  bot.action('help', (ctx) => {
    ctx.answerCbQuery();
    ctx.reply(HELP_TEXT);
  });

  // Статистика чата из базы данных
  bot.command('stats', async (ctx) => {
    try {
      const chatStats = await db.getChatStats(ctx.chat.id);

      if (!chatStats) {
        return ctx.reply('❌ В этом чате еще не было сыграно игр. Начните новую игру с /newgame');
      }

      const allPlayers = [...chatStats.playerStats].sort((a, b) => b.totalPoints - a.totalPoints);

      const statsText = allPlayers
        .slice(0, 10)
        .map((p, idx) => {
          const winRate = p.gamesPlayed > 0
            ? ((p.gamesWon / p.gamesPlayed) * 100).toFixed(1)
            : '0.0';
          return `${medal(idx)} @${p.username}: ${p.totalPoints} очков (${p.gamesWon}/${p.gamesPlayed} побед, ${winRate}%)`;
        })
        .join('\n');

      ctx.reply(
        `📊 Статистика чата "${chatStats.chatTitle}":\n\n` +
        `📈 Всего игр: ${chatStats.totalGames}\n` +
        `👥 Всего игроков: ${allPlayers.length}\n\n` +
        `🏆 Топ 10 игроков:\n${statsText}`
      );
    } catch (error) {
      console.error('Ошибка получения статистики:', error);
      ctx.reply('❌ Ошибка при получении статистики.');
    }
  });

  // История последних игр в чате
  bot.command('history', async (ctx) => {
    try {
      const recentGames = await db.getRecentGames(ctx.chat.id, 10);

      if (!recentGames || recentGames.length === 0) {
        return ctx.reply('❌ В этом чате еще не было сыграно игр. Начните новую игру с /newgame');
      }

      const historyText = recentGames
        .map((game, idx) => {
          const date = new Date(game.createdAt);
          const dateStr = date.toLocaleDateString('ru-RU') + ' ' +
            date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
          const playersList = game.players.map(p => `@${p.username}(${p.score})`).join(', ');
          const winner = game.winner?.username
            ? `🏆 ${game.winner.username}(${game.winner.finalScore})`
            : '❓ Не завершена';

          // Средняя оценка сложности слова, если игроки голосовали
          let ratingText = '';
          if (game.ratings?.length > 0) {
            const average = game.ratings.reduce((sum, r) => sum + r.rating, 0) / game.ratings.length;
            ratingText = ` | ⭐ ${average.toFixed(1)}`;
          }

          return `${idx + 1}. "${game.word}"${ratingText} | ${playersList}\n   ${winner} | ${dateStr}`;
        })
        .join('\n\n');

      ctx.reply(`📜 История последних 10 игр в чате:\n\n${historyText}`);
    } catch (error) {
      console.error('Ошибка получения истории:', error);
      ctx.reply('❌ Ошибка при получении истории игр.');
    }
  });
};
