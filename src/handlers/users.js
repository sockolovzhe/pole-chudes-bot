// Имена и упоминания пользователей Telegram (чистые функции без побочных эффектов)

// Отображаемое имя пользователя
function displayName(from) {
  return from.username || from.first_name;
}

function chatTitle(chat) {
  return chat.title || 'Личный чат';
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Упоминание, которое присылает игроку уведомление (работает и без username)
function mentionHtml(player) {
  return `<a href="tg://user?id=${player.id}">@${escapeHtml(player.username)}</a>`;
}

module.exports = { displayName, chatTitle, escapeHtml, mentionHtml };
