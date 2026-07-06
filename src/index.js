const { Telegraf } = require('telegraf');
const config = require('./config');
const Database = require('./database');
const RiddleGenerator = require('./riddleGenerator');
const registerHandlers = require('./handlers');

const bot = new Telegraf(config.botToken);
const db = new Database(config.mongoUri);
const riddleGenerator = new RiddleGenerator({ groqApiKey: config.groqApiKey });

registerHandlers(bot, { db, riddleGenerator });

bot.catch((err, ctx) => {
  console.error(`Ошибка для ${ctx.updateType}:`, err);
  ctx.reply('❌ Произошла ошибка. Попробуйте еще раз.');
});

// Команды, отображаемые в меню Telegram
const BOT_COMMANDS = [
  { command: 'newgame', description: 'Начать новую игру (для ведущего)' },
  { command: 'generate', description: 'Сгенерировать загадку дня (для ведущего)' },
  { command: 'join', description: 'Присоединиться к игре' },
  { command: 'try', description: 'Угадать букву: /try А' },
  { command: 'guess', description: 'Угадать слово целиком: /guess СЛОВО' },
  { command: 'next', description: 'Передать ход следующему игроку' },
  { command: 'status', description: 'Текущее состояние игры' },
  { command: 'stats', description: 'Статистика чата' },
  { command: 'history', description: 'История всех игр с оценками слов' },
  { command: 'words', description: 'Рейтинг слов по сложности' },
  { command: 'word', description: 'Загадать слово вручную (для ведущего)' },
  { command: 'end', description: 'Завершить игру (для ведущего)' },
  { command: 'test', description: '🧪 Тестовый режим: очки не сохраняются' },
  { command: 'stoptest', description: 'Выключить тестовый режим' },
];

async function startBot() {
  try {
    await db.connect();
    await bot.telegram.setMyCommands(BOT_COMMANDS);
    // launch() резолвится только при остановке бота, поэтому лог — в колбэке
    await bot.launch(() => console.log('🤖 Бот запущен!'));
  } catch (err) {
    console.error('Ошибка запуска бота:', err);
    process.exit(1);
  }
}

startBot();

// Graceful stop
async function stop(signal) {
  console.log('Остановка бота...');
  await db.disconnect();
  bot.stop(signal);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
