// Тестовый режим: /test и /stoptest — игра работает полностью,
// но в БД ничего не пишется (результаты, карьерные очки, регистрация игроков)

const { getGame } = require('../games');

module.exports = (bot) => {
  bot.command('test', (ctx) => {
    const game = getGame(ctx.chat.id);

    if (game.isTestMode) {
      return ctx.reply('🧪 Тестовый режим уже включен. Выключить: /stoptest');
    }

    game.isTestMode = true;
    ctx.reply(
      '🧪 Тестовый режим включен!\n\n' +
      'Игры идут как обычно, но результаты, очки и статистика НЕ сохраняются в базу.\n' +
      'Режим переживает /newgame — можно тестировать сколько угодно партий.\n\n' +
      'Выключить: /stoptest'
    );
  });

  bot.command('stoptest', (ctx) => {
    const game = getGame(ctx.chat.id);

    if (!game.isTestMode) {
      return ctx.reply('Тестовый режим и так выключен.');
    }

    // Сбрасываем тестовую партию целиком, чтобы её хвост не попал в реальную статистику
    game.isTestMode = false;
    game.reset();
    game.players = [];
    game.hostId = null;

    ctx.reply('✅ Тестовый режим выключен, тестовая игра сброшена. Следующие игры сохраняются как обычно.');
  });
};
