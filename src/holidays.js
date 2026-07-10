// Реальные праздники текущего дня с my-calend.ru — чтобы AI не выдумывал
// несуществующие «дни чего-нибудь», а выбирал из настоящего календаря
// и опирался на факты из описания праздника, а не на свои галлюцинации

const { TIMEZONE, formatTime } = require('./time');

const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const DESCRIPTION_MAX_CHARS = 900; // описания идут в промпт — держим его компактным (у gpt-oss-120b лимит 8k токенов/мин)
const MAX_DESCRIPTIONS = 8; // не больше стольких страниц описаний за раз

const MONTH_SLUGS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

// Кэш на день: праздники меняются раз в сутки, дёргать сайт на каждую генерацию незачем
const cache = { dateKey: null, holidays: null };

// Части даты по Екатеринбургу: { year, month, day } числами
function ekbDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric'
  }).formatToParts(date);
  const get = type => Number(parts.find(p => p.type === type).value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

// Ключ кэша: «2026-7-9» (без ведущих нулей)
function ekbDateKey(date = new Date()) {
  const { year, month, day } = ekbDateParts(date);
  return `${year}-${month}-${day}`;
}

// Хвост URL страницы даты my-calend.ru: «9-july» (день без ведущего нуля)
function ekbDateSlug(date = new Date()) {
  const { month, day } = ekbDateParts(date);
  return `${day}-${MONTH_SLUGS[month - 1]}`;
}

// Минимальная расшифровка HTML-сущностей в текстах my-calend.ru
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

// Вытащить праздники из страницы даты: [{ name, url }]. Первый список
// ul.holidays-items — праздники самой даты (дальше идут календарь и анонсы
// соседних дней). Имя лежит в <a> (есть страница описания, url) или в <span>
// (страницы нет, url = null); мусорные <span> вроде лайков отсекаются длиной
function parseHolidays(html) {
  const listMatch = /<ul class="holidays-items">([\s\S]*?)<\/ul>/.exec(html);
  if (!listMatch) return [];

  const holidays = [];
  const itemRe = /<li>([\s\S]*?)<\/li>/g;
  let item;
  while ((item = itemRe.exec(listMatch[1])) !== null) {
    const link = /<a href="(https?:\/\/my-calend\.ru\/holidays\/[a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/.exec(item[1]);
    const plain = link ? null : /<span>([\s\S]*?)<\/span>/.exec(item[1]);
    const name = htmlToText(link ? link[2] : plain ? plain[1] : '');
    if (name.length >= 3 && !holidays.find(h => h.name === name)) {
      holidays.push({ name, url: link ? link[1] : null });
    }
  }

  return holidays;
}

// Достать описание праздника из его страницы: первый содержательный абзац
// после заголовка (короткие <p> — хлебные крошки и служебные строки)
function parseDescription(html) {
  const afterTitle = html.slice(Math.max(0, html.indexOf('<h1')));
  const re = /<p>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = re.exec(afterTitle)) !== null) {
    const text = htmlToText(match[1]);
    if (text.length >= 60) return truncateAtSentence(text, DESCRIPTION_MAX_CHARS);
  }
  return null;
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
// description есть только у праздников со своей страницей на my-calend.ru
async function getHolidaysForToday() {
  const dateKey = ekbDateKey();
  if (cache.dateKey === dateKey) {
    return cache.holidays;
  }

  try {
    const dayHtml = await fetchPage(`https://my-calend.ru/holidays/${ekbDateSlug()}`);
    const parsed = parseHolidays(dayHtml);
    if (parsed.length === 0) {
      throw new Error('на странице не найдено ни одного праздника');
    }

    // Описания подгружаются параллельно; неудача одной страницы не мешает остальным
    let descriptionsLeft = MAX_DESCRIPTIONS;
    const holidays = await Promise.all(parsed.map(async ({ name, url }) => {
      if (!url || descriptionsLeft-- <= 0) return { name, description: null };
      try {
        return { name, description: parseDescription(await fetchPage(url)) };
      } catch (error) {
        console.warn(`[${formatTime()}] ⚠ Описание праздника «${name}» не загрузилось: ${error.message}`);
        return { name, description: null };
      }
    }));

    const withDescription = holidays.filter(h => h.description).length;
    console.log(
      `[${formatTime()}] ✓ Праздники с my-calend.ru (${holidays.length}, с описаниями: ${withDescription}): ` +
      holidays.map(h => h.name).join('; ')
    );
    cache.dateKey = dateKey;
    cache.holidays = holidays;
    return holidays;
  } catch (error) {
    console.warn(`[${formatTime()}] ⚠ Не удалось получить праздники с my-calend.ru: ${error.message}`);
    return null; // неудачу не кэшируем — следующая генерация попробует снова
  }
}

module.exports = { getHolidaysForToday, parseHolidays, parseDescription, ekbDateKey, ekbDateSlug };
