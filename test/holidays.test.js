const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHolidays, parseDescription, ekbDateKey } = require('../src/holidays');

// Упрощённый слепок структуры страницы calend.ru: маркеры дат + ссылки праздников,
// включая соседние дни, которые парсер должен отсеять
const DAY_PAGE = `
<a href="/day/2026-7-9/" rel="nofollow">9 июля 2026 года</a>
<p><a href="/holidays/0/0/3708/">День сахарного печенья</a></p>
<p><a href="/holidays/0/0/2334/">День независимости Аргентины</a></p>
<a href="/day/2026-7-10/" rel="nofollow">10 июля 2026 года</a>
<p><a href="/holidays/0/0/2223/">День победы русской армии</a></p>
<a href="/holidays/2026-7-9/" class="subtitle green">Праздники</a>
<p><a href="/holidays/0/0/2172/">День &laquo;дипломатов&raquo; &mdash; праздник</a></p>
<p><a href="/holidays/0/0/3708/">День сахарного печенья</a></p>
<a href="/day/2026-7-11/">11 июля</a>
<p><a href="/holidays/0/0/2485/">Всемирный день шоколада</a></p>
`;

test('parseHolidays берёт праздники только своей даты и убирает дубли', () => {
  const holidays = parseHolidays(DAY_PAGE, '2026-7-9');
  assert.deepEqual(holidays.map(h => h.name), [
    'День сахарного печенья',
    'День независимости Аргентины',
    'День «дипломатов» — праздник', // HTML-сущности расшифрованы
  ]);
  assert.equal(holidays[0].id, '3708');
});

test('parseHolidays для другой даты — другой набор', () => {
  const holidays = parseHolidays(DAY_PAGE, '2026-7-10');
  assert.deepEqual(holidays.map(h => h.name), ['День победы русской армии']);
});

test('parseDescription достаёт текст статьи и режет по предложению', () => {
  const html = '<div class="maintext" itemprop="articleBody"><p>Первое предложение. ' +
    'Второе &mdash; с <b>тегами</b>.</p></div>';
  // Теги заменяются пробелом (защита от склейки слов), поэтому перед точкой пробел
  assert.equal(parseDescription(html), 'Первое предложение. Второе — с тегами .');

  // Длинный текст обрезается по границе предложения
  const long = '<div class="maintext">' + ('Предложение из пяти слов ровно. '.repeat(100)) + '</div>';
  const text = parseDescription(long);
  assert.ok(text.length <= 900);
  assert.ok(text.endsWith('.'));

  assert.equal(parseDescription('<div>нет блока maintext</div>'), null);
});

test('ekbDateKey: формат без ведущих нулей и граница суток по Екатеринбургу', () => {
  assert.equal(ekbDateKey(new Date('2026-01-05T10:00:00Z')), '2026-1-5');
  // 19:30 UTC 9 июля = 00:30 10 июля по Екб
  assert.equal(ekbDateKey(new Date('2026-07-09T18:30:00Z')), '2026-7-9');
  assert.equal(ekbDateKey(new Date('2026-07-09T19:30:00Z')), '2026-7-10');
});
