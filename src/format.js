// Форматирование сообщений бота

const START_TEXT =
  '🎰 Добро пожаловать в игру "Поле чудес"!\n\n' +
  '📋 Команды:\n' +
  '/newgame - Начать новую игру (для ведущего)\n' +
  '/generate - Сгенерировать загадку дня (для ведущего)\n' +
  '/word <слово> - Загадать слово (для ведущего)\n' +
  '/join - Присоединиться к игре\n' +
  '/status - Показать текущее состояние игры\n' +
  '/stats - Показать статистику чата\n' +
  '/history - Показать историю всех игр с оценками слов\n' +
  '/words - Рейтинг слов по сложности\n' +
  '/guess <слово> - Угадать слово целиком\n' +
  '/end - Завершить игру (для ведущего)\n\n' +
  '💡 При правильном ответе ваш ход продолжается, при ошибке - ход переходит следующему.';

const HELP_TEXT =
  '📋 Полный список команд:\n\n' +
  '/newgame - Начать новую игру (для ведущего)\n' +
  '/generate - Сгенерировать загадку дня (для ведущего)\n' +
  '/word <слово> - Загадать слово (для ведущего)\n' +
  '/status - Показать текущее состояние игры\n' +
  '/stats - Показать статистику чата\n' +
  '/history - Показать историю всех игр с оценками слов\n' +
  '/words - Рейтинг слов по сложности\n' +
  '/try <буква> - Угадать букву\n' +
  '/guess <слово> - Угадать слово целиком\n' +
  '/next - Передать ход следующему игроку\n' +
  '/end - Завершить игру (для ведущего)\n' +
  '/cancelstart - Отменить отложенный старт игры (для ведущего)\n' +
  '/test и /stoptest - Тестовый режим: очки и статистика не сохраняются\n\n' +
  '⏰ Старт игры можно отложить: при утверждении загадки нажмите «Выбрать и отложить старт» ' +
  'и укажите время по Екатеринбургу — загадка сама придёт в чат в назначенный момент.\n\n' +
  '💡 При правильном ответе ваш ход продолжается, при ошибке - ход переходит следующему.';

const JOIN_KEYBOARD = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '👥 Присоединиться', callback_data: 'join' },
        { text: '❓ Помощь', callback_data: 'help' }
      ]
    ]
  }
};

// Экранировать спецсимволы MarkdownV2 (в т.ч. тире в составных словах)
function escapeMarkdownV2(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function medal(idx) {
  return idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '  ';
}

// Сообщение после загадывания слова (для /word и /newgame)
function formatWordAnnouncement(game) {
  return (
    (game.isTestMode ? '🧪 ТЕСТОВЫЙ РЕЖИМ — очки не сохраняются\n\n' : '') +
    `🎯 Слово загадано!\n\n` +
    `📝 Слово: ${game.getDisplayWord()}\n\n` +
    `👥 Игроки: ${game.players.length}\n\n` +
    `💬 Участники, нажмите кнопку "Присоединиться" чтобы присоединиться к игре!`
  );
}

// Финальная таблица очков ('' — если очков нет)
function formatFinalScores(game) {
  const scoresTable = game.getScoresTable();
  if (scoresTable.length === 0) return '';

  const lines = scoresTable
    .map((p, idx) => `${medal(idx)} @${p.username}: ${p.score} очков`)
    .join('\n');
  return `\n\n🏆 Финальная таблица очков:\n${lines}`;
}

// Детальная статистика очков за все буквы слова
function formatLetterPointsDetails(game, skipBonus = false) {
  const details = game.getLetterPointsDetails();
  if (details.length === 0) return '';

  const detailsText = details.map(formatLetterDetailLine).join('\n');
  const totalBase = details.reduce((sum, d) => sum + d.totalPoints, 0);
  const bonus = skipBonus ? 0 : Math.floor(totalBase / 3);
  const total = totalBase + bonus;

  return `\n📊 Детальная статистика очков:\n${detailsText}\n   Итого за буквы: ${totalBase} очков\n   Бонус (+1/3): ${bonus} очков\n   Всего: ${total} очков`;
}

// Строка статистики по одной букве
function formatLetterDetailLine(d) {
  let line = `   "${d.letter}": `;
  if (d.letterCount > 1) {
    line += `${d.basePoints} очков × ${d.letterCount} вхождений = ${d.totalPoints} очков`;
  } else {
    line += `${d.totalPoints} очков`;
  }
  if (d.alreadyGuessed) {
    line += ' (уже была угадана)';
  }
  return line;
}

// Блок с очками за угаданную букву (/try)
function formatLetterPointsMessage(result) {
  let message = `💰 Вы получили ${result.points} очков!`;
  if (result.letterCount > 1) {
    message += `\n   (${result.basePoints} очков × ${result.letterCount} вхождений = ${result.points} очков)`;
  }
  message += `\n   Всего у вас: ${result.totalScore} очков`;
  return message;
}

// Блок с очками и детальной статистикой за угаданное слово (/guess)
function formatGuessPointsMessage(result) {
  const bonusMessage = result.bonus > 0
    ? `   (Базовые очки за новые буквы: ${result.basePoints} + бонус: ${result.bonus})`
    : `   (Базовые очки за новые буквы: ${result.basePoints}, бонус не начислен - оставалась только одна буква)`;

  const letterDetails = result.letterPointsDetails.map(formatLetterDetailLine).join('\n');

  return (
    `💰 Вы получили ${result.points} очков!\n${bonusMessage}\n` +
    `   Всего у вас: ${result.totalScore} очков\n\n` +
    `📊 Детальная статистика очков:\n${letterDetails}\n` +
    `   Итого за новые буквы: ${result.basePoints} очков\n` +
    `   Бонус (+1/3): ${result.bonus} очков\n` +
    `   Всего получено: ${result.points} очков`
  );
}

// Полный статус игры (для команды и кнопки /status)
function formatStatus(game) {
  const currentPlayer = game.getCurrentPlayer();

  const playersList = game.players
    .map((p, idx) => {
      const marker = idx === game.currentPlayerIndex ? '🎲' : '👤';
      const status = p.isActive ? '' : ' (выбыл)';
      return `${marker} #${idx + 1} @${p.username || 'игрок'}${status}`;
    })
    .join('\n');

  const scoresTable = game.getScoresTable();
  const scoresList = scoresTable.length > 0
    ? scoresTable.map((p, idx) => `${medal(idx)} @${p.username}: ${p.score} очков`).join('\n')
    : 'Очки пока не начислены';

  const wrongLetters = game.getWrongLetters();

  return (
    (game.isTestMode ? '🧪 ТЕСТОВЫЙ РЕЖИМ — очки не сохраняются\n\n' : '') +
    `📊 Статус игры:\n\n` +
    `📝 Слово: ${game.getDisplayWord()}\n\n` +
    `🎲 Текущий ход: @${currentPlayer?.username || 'неизвестно'}\n\n` +
    `👥 Очередь игроков (${game.players.length}):\n${playersList}\n\n` +
    `✅ Угаданные буквы: ${Array.from(game.guessedLetters).sort().join(', ') || 'нет'}\n` +
    `❌ Неверные буквы: ${wrongLetters.length > 0 ? wrongLetters.join(', ') : 'нет'}\n\n` +
    `🏆 Таблица очков:\n${scoresList}`
  );
}

module.exports = {
  START_TEXT,
  HELP_TEXT,
  JOIN_KEYBOARD,
  escapeMarkdownV2,
  medal,
  formatWordAnnouncement,
  formatFinalScores,
  formatLetterPointsDetails,
  formatLetterPointsMessage,
  formatGuessPointsMessage,
  formatStatus,
};
