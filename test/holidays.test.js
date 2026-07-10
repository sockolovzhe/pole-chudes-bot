const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseHolidays, parseDescription, ekbDateKey, ekbDateSlug } = require('../src/holidays');

// Упрощённый слепок страницы даты my-calend.ru: первый ul.holidays-items —
// праздники дня (имя в <a> со страницей описания или в <span> без неё),
// дальше — календарь и списки соседних дней, которые парсер должен отсеять
const DAY_PAGE = `
<h2>Праздники 10 июля</h2>
<ul class="holidays-items">
  <li> <a href="https://my-calend.ru/holidays/samson-senognoy">Самсон Сеногной</a>
    <span>&nbsp;</span><span class="icon-1 icon-national" title="Народный праздник"></span>
    <form class="inline-block holidays-like" method="post"><input type="hidden" name="like" value="1294"><button><span>2474</span></button></form>
  </li>
  <li> <span>День коктейля &laquo;Пина Колада&raquo;</span>
    <form class="inline-block holidays-like" method="post"><input type="hidden" name="like" value="3036"><button><span>2740</span></button></form>
  </li>
  <li> <span>День котенка</span> </li>
  <li> <span>День котенка</span> </li>
</ul>
<h2>Праздники на ближайшую неделю</h2>
<ul class="holidays-items">
  <li> <span>Всемирный день шоколада</span> </li>
</ul>
`;

test('parseHolidays берёт первый список, различает <a> и <span>, убирает дубли', () => {
  const holidays = parseHolidays(DAY_PAGE);
  assert.deepEqual(holidays, [
    { name: 'Самсон Сеногной', url: 'https://my-calend.ru/holidays/samson-senognoy' },
    { name: 'День коктейля «Пина Колада»', url: null }, // HTML-сущности расшифрованы
    { name: 'День котенка', url: null },
  ]);
});

test('parseHolidays без списка праздников — пустой массив', () => {
  assert.deepEqual(parseHolidays('<html><body>ничего нет</body></html>'), []);
});

test('parseDescription берёт первый содержательный абзац после заголовка', () => {
  const html = '<p>Этот длинный абзац идёт до заголовка и не должен попасть в описание праздника никогда.</p>' +
    '<h1>Самсон Сеногной</h1><p>Главная / Праздники</p>' +
    '<p>Народный праздник отмечается 10 июля 2026 года (по старому стилю &ndash; 27 июня). ' +
    'В народе день назвали <b>сеногноем</b> за проливные дожди.</p>';
  assert.equal(
    parseDescription(html),
    'Народный праздник отмечается 10 июля 2026 года (по старому стилю – 27 июня). ' +
    'В народе день назвали сеногноем за проливные дожди.'
  );

  // Длинный текст обрезается по границе предложения
  const long = '<h1>Праздник</h1><p>' + 'Предложение из пяти слов ровно. '.repeat(100) + '</p>';
  const text = parseDescription(long);
  assert.ok(text.length <= 900);
  assert.ok(text.endsWith('.'));

  assert.equal(parseDescription('<h1>Праздник</h1><p>Коротко.</p>'), null);
});

test('ekbDateKey: формат без ведущих нулей и граница суток по Екатеринбургу', () => {
  assert.equal(ekbDateKey(new Date('2026-01-05T10:00:00Z')), '2026-1-5');
  // 19:30 UTC 9 июля = 00:30 10 июля по Екб
  assert.equal(ekbDateKey(new Date('2026-07-09T18:30:00Z')), '2026-7-9');
  assert.equal(ekbDateKey(new Date('2026-07-09T19:30:00Z')), '2026-7-10');
});

test('ekbDateSlug: хвост URL my-calend.ru — день и месяц по-английски', () => {
  assert.equal(ekbDateSlug(new Date('2026-01-05T10:00:00Z')), '5-january');
  assert.equal(ekbDateSlug(new Date('2026-07-09T19:30:00Z')), '10-july');
  assert.equal(ekbDateSlug(new Date('2026-12-31T10:00:00Z')), '31-december');
});
