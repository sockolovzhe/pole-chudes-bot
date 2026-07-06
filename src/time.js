// Получить время по Екатеринбургу (UTC+5)
function getEkaterinburgTime() {
  const now = new Date();
  const utcTime = new Date(now.getTime() + now.getTimezoneOffset() * 60 * 1000);
  return new Date(utcTime.getTime() + 5 * 60 * 60 * 1000);
}

// Форматировать время как ЧЧ:ММ:СС
function formatTime(date = null) {
  const d = date || getEkaterinburgTime();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

module.exports = { getEkaterinburgTime, formatTime };
