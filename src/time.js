// Всё время в боте отображается по Екатеринбургу (UTC+5, перехода на летнее время нет)
const TIMEZONE = 'Asia/Yekaterinburg';
const UTC_OFFSET_HOURS = 5;

// Время ЧЧ:ММ:СС по Екатеринбургу (для логов)
function formatTime(date = new Date()) {
  return date.toLocaleTimeString('ru-RU', { timeZone: TIMEZONE, hour12: false });
}

// Время ЧЧ:ММ по Екатеринбургу
function formatClock(date) {
  return date.toLocaleTimeString('ru-RU', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' });
}

// Дата и время «09.07.2026 18:30» по Екатеринбургу (для истории игр)
function formatDateTime(date) {
  return date.toLocaleDateString('ru-RU', { timeZone: TIMEZONE }) + ' ' + formatClock(date);
}

// Одна ли календарная дата по Екатеринбургу у двух моментов времени
function isSameEkbDay(a, b) {
  return a.toLocaleDateString('ru-RU', { timeZone: TIMEZONE }) ===
    b.toLocaleDateString('ru-RU', { timeZone: TIMEZONE });
}

// Разобрать «ЧЧ:ММ» как ближайший будущий момент по Екатеринбургу.
// Возвращает Date или null, если формат не распознан.
function parseScheduleTime(input, now = new Date()) {
  const match = /^([01]?\d|2[0-3])[:.\s]([0-5]\d)$/.exec((input || '').trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  // Пояс фиксированный, поэтому «сегодня в ЧЧ:ММ по Екб» считается простым сдвигом от UTC
  const nowEkb = new Date(now.getTime() + UTC_OFFSET_HOURS * 3600 * 1000);
  const target = new Date(Date.UTC(
    nowEkb.getUTCFullYear(), nowEkb.getUTCMonth(), nowEkb.getUTCDate(),
    hours - UTC_OFFSET_HOURS, minutes, 0, 0
  ));

  // Время на сегодня уже прошло — значит, завтра
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  return target;
}

module.exports = { TIMEZONE, formatTime, formatClock, formatDateTime, isSameEkbDay, parseScheduleTime };
