// Реальные праздники текущего дня с calend.ru — чтобы AI не выдумывал
// несуществующие «дни чего-нибудь», а выбирал из настоящего календаря
// и опирался на факты из описания праздника, а не на свои галлюцинации

const { TIMEZONE, formatTime } = require('./time');

const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const DESCRIPTION_MAX_CHARS = 900; // описания идут в промпт — держим его компактным (у gpt-oss-120b лимит 8k токенов/мин)
const MAX_DESCRIPTIONS = 8; // не больше стольких страниц описаний за раз

// Кэш на день: праздники меняются раз в сутки, дёргать сайт на каждую генерацию незачем
const cache = { dateKey: null, holidays: null };

// Дата по Екатеринбургу в формате URL calend.ru: «2026-7-9» (без ведущих нулей)
function ekbDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Минимальная расшифровка HTML-сущностей в текстах calend.ru
function decodeEntities(text) {
  return text
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

// HTML-фрагмент -> чистый текст в одну строку
function htmlToText(fragment) {
  return decodeEntities(fragment.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Обрезать длинный текст по границе предложения
function truncateAtSentence(text, maxChars) {
  if (text.length <= maxChars) return text;
  const cut = text.lastIndexOf('. ', maxChars);
  return cut > maxChars / 2 ? text.slice(0, cut + 1) : text.slice(0, maxChars);
}

// Вытащить из HTML праздники нужной даты: [{ id, name }]. Страница содержит
// и соседние дни, поэтому идём по документу и относим каждый праздник
// к последнему встреченному маркеру даты
function parseHolidays(html, dateKey) {
  const holidays = [];
  const re = /<a href="\/(?:day|holidays)\/(\d{4}-\d{1,2}-\d{1,2})\/"|<a href="\/holidays\/0\/0\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/g;

  let currentDate = null;
  let match;
  while ((match = re.exec(html)) !== null) {
    if (match[1]) {
      currentDate = match[1];
      continue;
    }

    if (currentDate !== dateKey) continue;
    const name = htmlToText(match[3]);
    if (name && !holidays.find(h => h.name === name)) {
      holidays.push({ id: match[2], name });
    }
  }

  return holidays;
}

// Достать описание праздника из его страницы (блок maintext)
function parseDescription(html) {
  const match = /<div class="maintext"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  if (!match) return null;

  const text = htmlToText(match[1]);
  return text ? truncateAtSentence(text, DESCRIPTION_MAX_CHARS) : null;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
}

// Праздники на сегодня (по Екатеринбургу): [{ name, description }] или null,
// если сайт недоступен — тогда генерация работает по-старому, на знаниях модели.
// description может быть null, если страница праздника не загрузилась
async function getHolidaysForToday() {
  const dateKey = ekbDateKey();
  if (cache.dateKey === dateKey) {
    return cache.holidays;
  }

  try {
    const dayHtml = await fetchPage(`https://www.calend.ru/holidays/${dateKey}/`);
    const parsed = parseHolidays(dayHtml, dateKey);
    if (parsed.length === 0) {
      throw new Error('на странице не найдено ни одного праздника');
    }

    // Описания подгружаются параллельно; неудача одной страницы не мешает остальным
    const holidays = await Promise.all(parsed.slice(0, MAX_DESCRIPTIONS).map(async ({ id, name }) => {
      try {
        return { name, description: parseDescription(await fetchPage(`https://www.calend.ru/holidays/0/0/${id}/`)) };
      } catch (error) {
        console.warn(`[${formatTime()}] ⚠ Описание праздника «${name}» не загрузилось: ${error.message}`);
        return { name, description: null };
      }
    }));

    const withDescription = holidays.filter(h => h.description).length;
    console.log(
      `[${formatTime()}] ✓ Праздники с calend.ru (${holidays.length}, с описаниями: ${withDescription}): ` +
      holidays.map(h => h.name).join('; ')
    );
    cache.dateKey = dateKey;
    cache.holidays = holidays;
    return holidays;
  } catch (error) {
    console.warn(`[${formatTime()}] ⚠ Не удалось получить праздники с calend.ru: ${error.message}`);
    return null; // неудачу не кэшируем — следующая генерация попробует снова
  }
}

module.exports = { getHolidaysForToday, parseHolidays, parseDescription, ekbDateKey };
