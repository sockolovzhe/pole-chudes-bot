// Работа со значениями оценок игры. Оценки хранятся по одной записи на игрока
// с тремя необязательными полями (шкала 1-10):
//   difficulty — сложность слова, question — интересность вопроса,
//   process — интересность отгадки (процесса игры)

const RATING_FIELDS = ['difficulty', 'question', 'process'];

// Значение категории у одной записи (null — игрок эту категорию не оценивал)
function categoryValue(entry, field) {
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
