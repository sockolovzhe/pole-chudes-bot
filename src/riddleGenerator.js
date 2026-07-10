const { generateText } = require('ai');
const { createGroq } = require('@ai-sdk/groq');
const { TIMEZONE, formatTime } = require('./time');
const { getHolidaysForToday } = require('./holidays');
const { normalizeString } = require('./letters');

// Разобрать ответ AI: извлечь слово, тему картинки и текст загадки
function parseRiddle(text) {
  // Загаданное слово: только до конца строки; слабые модели иногда пишут
  // пробелы подчёркиваниями — приводим их к пробелам
  const wordMatch = text.match(/ЗАГАДАННОЕ_СЛОВО:[ \t]*([А-ЯЁа-яё][А-ЯЁа-яё_ -]*)/);
  let word = wordMatch
    ? wordMatch[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
    : null;

  if (!word) {
    throw new Error('Не удалось извлечь загаданное слово из ответа AI');
  }

  // Некоторые модели пишут слово в разрядку («А Н А Х И Т А») — склеиваем
  if (/^(?:[А-ЯЁ] )+[А-ЯЁ]$/.test(word)) {
    word = word.replace(/ /g, '');
  }

  // Тема для картинки (английские слова для генерации изображения)
  const imageThemeMatch = text.match(/ТЕМА_ДЛЯ_КАРТИНКИ:\s*([a-zA-Z\s]+)/);
  const imageTheme = imageThemeMatch ? imageThemeMatch[1].trim() : 'celebration holiday';

  // Убираем служебные строки из текста для пользователей
  let riddleText = text.replace(/ЗАГАДАННОЕ_СЛОВО:[ \t]*[А-ЯЁа-яё_ -]+\n*/g, '');
  riddleText = riddleText.replace(/ТЕМА_ДЛЯ_КАРТИНКИ:[ \t]*[a-zA-Z ]+[ \t]*\n*/g, '');
  // Строка "СЛОВО: _ _ _" не нужна — бот сам показывает маску нужной длины
  riddleText = riddleText.replace(/^СЛОВО:[ \t_]*$/gm, '');

  return {
    riddleText: riddleText.trim(),
    word,
    imageTheme,
    fullResponse: text
  };
}

// Проверить качество загадки; вернуть null или { reason, canFallback }.
// canFallback: false — жёсткое нарушение (лимиты слова), такую загадку не используем вовсе
function validateRiddle({ word, riddleText }) {
  const letterCount = word.replace(/[ -]/g, '').length;
  if (letterCount < 7) {
    return { reason: `слово слишком короткое (${letterCount} букв)`, canFallback: false };
  }

  if (word.length > 20) {
    return { reason: `слово слишком длинное (${word.length} символов)`, canFallback: false };
  }

  if (word.split(/\s+/).length > 2) {
    return { reason: `больше двух слов ("${word}")`, canFallback: false };
  }

  // Ответ (или его часть с учётом склонений) не должен встречаться в тексте загадки
  const lowerText = riddleText.toLowerCase();
  for (const part of word.split(/[ -]/)) {
    if (part.length < 4) continue;
    const stem = part.slice(0, Math.max(4, part.length - 2)).toLowerCase();
    if (lowerText.includes(stem)) {
      return { reason: `ответ "${part}" упоминается в тексте загадки`, canFallback: true };
    }
  }

  return null;
}

// Замаскировать утёкший ответ в тексте загадки (все словоформы -> ███).
// Крайняя мера, если переписать текст через AI не удалось.
// Основа слова берётся так же, как в validateRiddle
function maskWordInText(riddleText, word) {
  let text = riddleText;
  for (const part of word.split(/[ -]/)) {
    if (part.length < 4) continue;
    const stem = part.slice(0, Math.max(4, part.length - 2));
    text = text.replace(new RegExp(`${stem}[а-яёa-z]*`, 'gi'), '███');
  }
  return text;
}

// Примеры подходящих слов для промпта (в каждый запрос попадает случайная часть,
// чтобы модель не повторяла одни и те же слова)
const WORD_EXAMPLES = [
  'РАНЬШИНА', 'ЭЙДОЛОН', 'АНГОСТУРА', 'ХЛОРПИКРИН', 'КОНГЕНЕР', 'ГЕТЕРОДИН',
  'ЛУНДСТРЁМ', 'ПОЛУШКА', 'ВАРАЯТХИСА', 'ПРЕКАРИЗАЦИЯ', 'БАНДАБЕРГ',
  'МЕНДЕЛЕВИЙ', 'ДАГЕРРОТИПИЯ', 'ТЕОФИЛЛИН', 'СТРЕПТОМИЦИН', 'АЛЬФРЕД НОБЕЛЬ',
];

function sampleExamples(count = 6) {
  const shuffled = [...WORD_EXAMPLES].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

class RiddleGenerator {
  // Генерация через бесплатный Groq API (модель openai/gpt-oss-120b).
  // generateTextFn — подмена AI-вызова для тестов
  constructor({ groqApiKey, generateTextFn } = {}) {
    this.providers = [];
    this.generateText = generateTextFn || generateText;

    if (groqApiKey) {
      const groq = createGroq({ apiKey: groqApiKey });
      // gpt-oss-120b — флагман бесплатного Groq; llama-3.3-70b отключают 16.08.2026
      this.providers.push({ name: 'groq', model: groq('openai/gpt-oss-120b') });
    }
  }

  // Текущая дата для запроса (по Екатеринбургу)
  getCurrentDate() {
    return new Date().toLocaleDateString('ru-RU', {
      timeZone: TIMEZONE,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
  }

  buildPrompt(holidays = null, excludeWords = []) {
    const currentDate = this.getCurrentDate();

    // Слова, которые ведущий уже отклонил кнопкой «Другое слово»
    const excludeRule = excludeWords.length
      ? `\n   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНЫ слова, которые ведущий уже отклонил: ${excludeWords.map(w => `"${w}"`).join(', ')} — выбери СОВЕРШЕННО ДРУГОЕ слово, лучше всего по другому празднику или другому факту из описания`
      : '';

    // Если удалось получить реальные праздники — модель выбирает строго из них
    // и берёт факты только из описаний, иначе полагаемся на её знания (менее надёжно)
    const holidaySteps = holidays?.length
      ? `1. Сегодня ${currentDate}. Вот СПИСОК РЕАЛЬНЫХ праздников этого дня с описаниями (по данным календаря):
${holidays.map((h, i) => `   Праздник ${i + 1}: ${h.name}${h.description ? `\n   Описание: ${h.description}` : ''}`).join('\n\n')}
2. Выбери из этого списка ОДИН праздник, который можно интересно обыграть в формате вопроса. КАТЕГОРИЧЕСКИ НЕЛЬЗЯ выдумывать другие праздники или менять их названия.`
      : `1. Определи, какие сегодня (${currentDate}) международные или неофициальные праздники.
2. Выбери ОДИН праздник, который можно интересно обыграть в формате вопроса.`;

    // Требование к фактам: при наличии описаний — только из них
    const factsRule = holidays?.length
      ? `\n   - Все факты, даты и имена бери СТРОГО из описания выбранного праздника (см. выше). НЕ добавляй фактов из своих знаний — только пересказывай описание живо и с юмором.`
      : '';

    return `Ты — генератор загадок для телеграм-игры «Поле чудес».

Твоя задача — автоматически создать загадку дня по следующему алгоритму:

${holidaySteps}
3. СНАЧАЛА выбери загаданное слово. ЖЁСТКИЕ ПРАВИЛА для слова:
   - ЛУЧШЕ ВСЕГО ОДНО слово, максимум ДВА слова
   - вся строка НЕ ДЛИННЕЕ 20 СИМВОЛОВ (посчитай символы, включая пробел!), но не короче 7 букв
   - на русском языке
   - РЕДКОЕ и сложное для угадывания — такое, которое почти не встречается в повседневной жизни
   - отлично подходят: фамилии людей, имеющих отношение к празднику, названия химических веществ и минералов, научные и профессиональные термины, устаревшие слова, редкие географические названия
   - можно использовать дефисы для составных слов${excludeRule}${holidays?.length ? `
   - ЛУЧШЕ ВСЕГО взять редкое слово прямо из описания выбранного праздника (термин, фамилию, географическое название) — тогда факты честно подводят к ответу; если в описании подходящего слова нет, возьми редкое слово, тесно связанное с темой праздника
   - ВНИМАНИЕ: если ты взял слово из описания, то при пересказе описания в тексте загадки ЗАМЕНИ это слово оборотами «этот город», «этот человек», «это вещество» и т.п. — ответ не должен прозвучать до вопроса` : ''}
4. Примеры подходящих слов: ${sampleExamples().map(w => `"${w}"`).join(', ')}
   Примеры показывают ТИП слов — НЕ выбирай слово из этого списка, придумай своё такого же уровня редкости!
   Примеры НЕПОДХОДЯЩИХ слов: "ФЕРМЕНТАЦИЯ ЧАЙНЫХ ЛИСТЬЕВ" (три слова, длиннее 20 символов), "ЧАЙ" (слишком короткое и простое)
5. Потом сформируй текст загадки:
   - Торжественное приветствие и объявление праздника.
   - 3–5 коротких фактов, связанных с этим праздником, поданных живо и с юмором.
   - Факты должны логично подводить к загаданному слову.${factsRule}
6. В конце задай вопрос, ответом на который является загаданное слово.
7. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО упоминать загаданное слово (в любой форме и склонении) в тексте загадки, фактах и вопросе — иначе загадка теряет смысл.

СТИЛЬ ПОДАЧИ — Леонид Якубович, ведущий капитал-шоу «Поле чудес». Пиши весь текст загадки от его лица:
- Торжественно-тёплое приветствие в его духе: «Здравствуйте, уважаемые дамы и господа! В эфире капитал-шоу „Поле чудес“!»
- Обращайся к игрокам и «уважаемым телезрителям», используй его фирменные обороты: «Итак, внимание!», «В студию!», «Крутите барабан!», «Автоматически!»
- Факты подавай как ведущий со сцены: с восклицаниями, риторическими вопросами, добродушным юмором и лёгкими отступлениями («А вы знали, дорогие мои?..»)
- Перед вопросом обязательно скажи: «Итак, внимание, вопрос!»
- Тон: жизнерадостный, артистичный, по-доброму ироничный. Без оскорблений.

ФОРМАТ ОТВЕТА (СТРОГО СОБЛЮДАЙ):

🎩 [Приветствие ведущего и объявление праздника] 🎉

[Текст загадки и факты в стиле Якубовича, 3–5 абзацев]

Итак, внимание, вопрос! [вопрос]

ЗАГАДАННОЕ_СЛОВО: [слово]

СЛОВО: _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

НЕ добавляй никаких пояснений, рассуждений или комментариев.

ВАЖНО:
- Обязательно укажи загаданное слово после "ЗАГАДАННОЕ_СЛОВО:" чтобы я мог его извлечь программно
- В строке "ЗАГАДАННОЕ_СЛОВО:" пиши слово СЛИТНО, обычными буквами: НЕ разделяй буквы пробелами или подчёркиваниями (правильно: "ПРИМЕР", неправильно: "П Р И М Е Р"). Если слов два — раздели их одним пробелом
- Слово: не короче 7 букв, не длиннее 20 символов, максимум два слова
- Само загаданное слово НЕ должно встречаться в тексте загадки и вопросе
- После загаданного слова добавь строку "ТЕМА_ДЛЯ_КАРТИНКИ: [3-5 английских слов, описывающих ПРЕДМЕТЫ и сцену праздника]". НЕ пиши название праздника и слова "day", "world", "national" — только осязаемые предметы! (например: "ТЕМА_ДЛЯ_КАРТИНКИ: chocolate pieces cocoa beans truffles" или "ТЕМА_ДЛЯ_КАРТИНКИ: vintage rocket planets stars")`;
  }

  // Промпт для переписывания загадки, в тексте которой проговорился ответ
  buildRewritePrompt({ word, riddleText }) {
    return `Вот текст загадки для игры «Поле чудес». Ответ на загадку: «${word}».

Перепиши текст так, чтобы ответ НЕ встречался в нём НИ В КАКОЙ форме и склонении (ни целиком, ни частями):
- заменяй его по смыслу оборотами «этот город», «этот человек», «это вещество» и т.п.
- всё остальное сохрани без изменений: стиль, факты, структуру, эмодзи и вопрос в конце
- в ответе верни ТОЛЬКО переписанный текст загадки, без пояснений и комментариев

ТЕКСТ ЗАГАДКИ:
${riddleText}`;
  }

  // Убрать спойлер из текста загадки: попросить AI переписать текст оборотами
  // без ответа (проверяется валидатором); если не вышло — грубая маскировка ███
  async removeSpoiler(riddle) {
    const REWRITE_ATTEMPTS = 2;

    for (const provider of this.providers) {
      for (let attempt = 1; attempt <= REWRITE_ATTEMPTS; attempt++) {
        try {
          const { text } = await this.generateText({
            model: provider.model,
            prompt: this.buildRewritePrompt(riddle),
            maxTokens: 2500,
          });

          const candidate = { ...riddle, riddleText: text.trim() };
          if (candidate.riddleText && !validateRiddle(candidate)) {
            console.log(`[${formatTime()}] ✓ Спойлер переписан оборотами через ${provider.name}`);
            return candidate;
          }
          console.warn(`[${formatTime()}] ⚠ Переписывание ${attempt}: ответ всё ещё в тексте`);
        } catch (error) {
          console.warn(`[${formatTime()}] ⚠ Переписывание ${attempt} через ${provider.name}: ${error.message}`);
          if (/rate limit/i.test(error.message)) {
            await new Promise(resolve => setTimeout(resolve, 12000));
          }
        }
      }
    }

    return { ...riddle, riddleText: maskWordInText(riddle.riddleText, riddle.word) };
  }

  // Сгенерировать загадку дня: до 3 попыток на провайдера, некачественные
  // результаты (короткое слово, спойлер в тексте) идут в запас на крайний случай.
  // excludeWords — слова, отклонённые ведущим кнопкой «Другое слово»
  async generateDailyRiddle(excludeWords = []) {
    if (this.providers.length === 0) {
      throw new Error('Не настроен AI-провайдер: укажите GROQ_API_KEY в .env');
    }

    const ATTEMPTS_PER_PROVIDER = 6;
    // Реальные праздники дня с my-calend.ru (null — сайт недоступен, промпт по-старому)
    const holidays = await getHolidaysForToday();
    const prompt = this.buildPrompt(holidays, excludeWords);
    const excludeSet = new Set(excludeWords.map(w => normalizeString(w)));
    let imperfectRiddle = null;
    let lastError;

    for (const provider of this.providers) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_PROVIDER; attempt++) {
        try {
          const { text } = await this.generateText({
            model: provider.model,
            prompt,
            maxTokens: 2500,
          });

          const riddle = parseRiddle(text);

          // Отклонённое слово не годится даже в запас — пробуем ещё раз
          if (excludeSet.has(normalizeString(riddle.word))) {
            console.warn(`[${formatTime()}] ⚠ ${provider.name}, попытка ${attempt}: слово "${riddle.word}" уже отклонялось ведущим`);
            continue;
          }

          const problem = validateRiddle(riddle);

          if (!problem) {
            console.log(`[${formatTime()}] ✓ Загадка сгенерирована через ${provider.name} (слово: "${riddle.word}")`);
            return riddle;
          }

          console.warn(`[${formatTime()}] ⚠ ${provider.name}, попытка ${attempt}: ${problem.reason}`);
          // В запас годятся только загадки без нарушения лимитов слова
          if (problem.canFallback && !imperfectRiddle) {
            imperfectRiddle = riddle;
          }
        } catch (error) {
          console.error(`Ошибка генерации через ${provider.name} (попытка ${attempt}):`, error.message);
          lastError = error;
          // Groq ограничивает токены в минуту; промпт с описаниями праздников
          // объёмный, поэтому при упоре в лимит ждём перед следующей попыткой
          if (/rate limit/i.test(error.message) && attempt < ATTEMPTS_PER_PROVIDER) {
            await new Promise(resolve => setTimeout(resolve, 12000));
          }
        }
      }
    }

    if (imperfectRiddle) {
      // Единственный повод для запаса — спойлер в тексте; убираем его переписыванием
      console.warn(`[${formatTime()}] ⚠ Используем запасную загадку, убираем спойлер (слово: "${imperfectRiddle.word}")`);
      return this.removeSpoiler(imperfectRiddle);
    }

    throw lastError || new Error('Не удалось сгенерировать подходящую загадку, попробуйте еще раз');
  }

  // Сгенерировать картинку по теме через бесплатный Pollinations.ai.
  // Генерация занимает до минуты, поэтому вызывается в фоне; при неудаче — null
  async generateImage(imageTheme) {
    const prompt = encodeURIComponent(`${imageTheme}, festive bright illustration, no text, no letters, no words, no typography`);
    const url = `https://image.pollinations.ai/prompt/${prompt}?width=800&height=600&nologo=true`;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 1000) {
          throw new Error('пустой ответ вместо изображения');
        }

        console.log(`[${formatTime()}] ✓ Картинка сгенерирована (${Math.round(buffer.length / 1024)} КБ, тема: ${imageTheme})`);
        return buffer;
      } catch (error) {
        console.warn(`[${formatTime()}] ⚠ Картинка, попытка ${attempt}: ${error.message}`);
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    return null;
  }
}

RiddleGenerator.parseRiddle = parseRiddle;
RiddleGenerator.validateRiddle = validateRiddle;
RiddleGenerator.maskWordInText = maskWordInText;

module.exports = RiddleGenerator;
