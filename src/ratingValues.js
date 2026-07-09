// Работа со значениями оценок игры. Оценки хранятся по одной записи на игрока
// с тремя необязательными полями (шкала 1-10):
//   difficulty — сложность слова, question — интересность вопроса,
//   process — интересность отгадки (процесса игры).
// Устаревшее поле rating — сложность по шкале 1-5 (до 10.07.2026), в расчётах ×2

const RATING_FIELDS = ['difficulty', 'question', 'process'];

// Значение категории у одной записи (null — игрок эту категорию не оценивал)
function categoryValue(entry, field) {
  if (field === 'difficulty' && entry.difficulty == null && entry.rating != null) {
    return entry.rating * 2; // старая шкала 1-5 -> 2-10
  }
  return entry[field] ?? null;
}

// Средняя оценка категории по записям (null — никто не оценивал)
function averageFor(entries, field) {
  const values = (entries || [])
    .map(entry => categoryValue(entry, field))
    .filter(value => value != null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

module.exports = { RATING_FIELDS, categoryValue, averageFor };
