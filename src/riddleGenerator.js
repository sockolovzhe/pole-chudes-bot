const { generateText } = require('ai');
const { createGroq } = require('@ai-sdk/groq');
const { formatTime } = require('./time');

// Разобрать ответ AI: извлечь слово, тему картинки и текст загадки
function parseRiddle(text) {
  // Загаданное слово: только до конца строки; слабые модели иногда пишут
  // пробелы подчёркиваниями — приводим их к пробелам
  const wordMatch = text.match(/ЗАГАДАННОЕ_СЛОВО:[ \t]*([А-ЯЁа-яё][А-ЯЁа-яё_ -]*)/);
  const word = wordMatch
    ? wordMatch[1].replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
    : null;

  if (!word) {
    throw new Error('Не удалось извлечь загаданное слово из ответа AI');
  }

  // Тема для картинки
  const imageThemeMatch = text.match(/ТЕМА_ДЛЯ_КАРТИНКИ:\s*([a-zA-Z\s]+)/);
  const imageTheme = imageThemeMatch ? imageThemeMatch[1].trim().replace(/\s+/g, ',') : 'celebration,holiday';

  // Случайное изображение через Lorem Picsum: seed на основе темы для консистентности
  const seed = imageTheme.replace(/,/g, '-');
  const imageUrl = `https://picsum.photos/seed/${seed}/800/600`;

  // Убираем служебные строки из текста для пользователей
  let riddleText = text.replace(/ЗАГАДАННОЕ_СЛОВО:[ \t]*[А-ЯЁа-яё_ -]+\n*/g, '');
  riddleText = riddleText.replace(/ТЕМА_ДЛЯ_КАРТИНКИ:[ \t]*[a-zA-Z ]+[ \t]*\n*/g, '');
  // Строка "СЛОВО: _ _ _" не нужна — бот сам показывает маску нужной длины
  riddleText = riddleText.replace(/^СЛОВО:[ \t_]*$/gm, '');

  return {
    riddleText: riddleText.trim(),
    word,
    imageUrl,
    fullResponse: text
  };
}

// Проверить качество загадки; вернуть текст проблемы или null
function validateRiddle({ word, riddleText }) {
  const letterCount = word.replace(/[ -]/g, '').length;
  if (letterCount < 8) {
    return `слово слишком короткое (${letterCount} букв)`;
  }

  // Ответ (или его часть с учётом склонений) не должен встречаться в тексте загадки
  const lowerText = riddleText.toLowerCase();
  for (const part of word.split(/[ -]/)) {
    if (part.length < 4) continue;
    const stem = part.slice(0, Math.max(4, part.length - 2)).toLowerCase();
    if (lowerText.includes(stem)) {
      return `ответ "${part}" упоминается в тексте загадки`;
    }
  }

  return null;
}

class RiddleGenerator {
  // Генерация через бесплатный Groq API (модель Llama 3.3 70B)
  constructor({ groqApiKey } = {}) {
    this.providers = [];

    if (groqApiKey) {
      const groq = createGroq({ apiKey: groqApiKey });
      this.providers.push({ name: 'groq', model: groq('llama-3.3-70b-versatile') });
    }
  }

  // Текущая дата для запроса
  getCurrentDate() {
    return new Date().toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
  }

  buildPrompt() {
    const currentDate = this.getCurrentDate();

    return `Ты — генератор загадок для телеграм-игры «Поле чудес».

Твоя задача — автоматически создать загадку дня по следующему алгоритму:

1. Определи, какие сегодня (${currentDate}) международные или неофициальные праздники.
2. Выбери ОДИН праздник, который можно интересно обыграть в формате вопроса.
3. Сформируй текст загадки:
   - Вступление с названием праздника (можно с эмоциями и эмодзи).
   - 3–5 коротких фактов, связанных с этим праздником.
   - Факты должны логично подводить к одному конкретному слову или фамилии.
4. В конце задай вопрос, ответом на который является одно слово.
5. Загаданное слово должно быть:
   - общеизвестным (можно использовать известные фамилии, если они связаны с праздником)
   - на русском языке
   - ОБЯЗАТЕЛЬНО НЕ МЕНЬШЕ 12 БУКВ (чем длиннее, тем лучше!)
   - можно использовать пробелы для фраз и дефисы для составных слов
6. Сложность слова: максимально высокая (12+ букв, желательно 14-18 букв).
7. Примеры подходящих слов: "КОСМОНАВТИКА", "ЭЛЕКТРИЧЕСТВО", "ДОСТОЕВСКИЙ", "МЕНДЕЛЕЕВ", "КИНЕМАТОГРАФИЯ", "РАУЛЬ ФОЛЛЕРО", "САНКТ-ПЕТЕРБУРГ"
8. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО упоминать загаданное слово (в любой форме и склонении) в тексте загадки, фактах и вопросе — иначе загадка теряет смысл.

ФОРМАТ ОТВЕТА (СТРОГО СОБЛЮДАЙ):

🎉 НАЗВАНИЕ ПРАЗДНИКА 🎉

[Текст загадки и факты, 3–5 абзацев]

ВОПРОС: [вопрос]

ЗАГАДАННОЕ_СЛОВО: [слово]

СЛОВО: _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

НЕ добавляй никаких пояснений, рассуждений или комментариев.
Допускается лёгкий разговорный стиль, но без оскорблений.

ВАЖНО:
- Обязательно укажи загаданное слово после "ЗАГАДАННОЕ_СЛОВО:" чтобы я мог его извлечь программно
- В строке "ЗАГАДАННОЕ_СЛОВО:" пиши слово обычными буквами, части разделяй пробелами (НЕ подчёркиваниями)
- Слово должно быть НЕ МЕНЬШЕ 12 БУКВ!
- Само загаданное слово НЕ должно встречаться в тексте загадки и вопросе
- После загаданного слова добавь строку "ТЕМА_ДЛЯ_КАРТИНКИ: [название праздника на английском, 1-3 слова]" (например: "ТЕМА_ДЛЯ_КАРТИНКИ: world charity day" или "ТЕМА_ДЛЯ_КАРТИНКИ: cosmonautics space")`;
  }

  // Сгенерировать загадку дня: до 3 попыток на провайдера, некачественные
  // результаты (короткое слово, спойлер в тексте) идут в запас на крайний случай
  async generateDailyRiddle() {
    if (this.providers.length === 0) {
      throw new Error('Не настроен AI-провайдер: укажите GROQ_API_KEY в .env');
    }

    const ATTEMPTS_PER_PROVIDER = 3;
    const prompt = this.buildPrompt();
    let imperfectRiddle = null;
    let lastError;

    for (const provider of this.providers) {
      for (let attempt = 1; attempt <= ATTEMPTS_PER_PROVIDER; attempt++) {
        try {
          const { text } = await generateText({
            model: provider.model,
            prompt,
            maxTokens: 2000,
          });

          const riddle = parseRiddle(text);
          const problem = validateRiddle(riddle);

          if (!problem) {
            console.log(`[${formatTime()}] ✓ Загадка сгенерирована через ${provider.name} (слово: "${riddle.word}")`);
            return riddle;
          }

          console.warn(`[${formatTime()}] ⚠ ${provider.name}, попытка ${attempt}: ${problem}`);
          imperfectRiddle = imperfectRiddle || riddle;
        } catch (error) {
          console.error(`Ошибка генерации через ${provider.name} (попытка ${attempt}):`, error.message);
          lastError = error;
        }
      }
    }

    // Все попытки с изъянами — лучше неидеальная загадка, чем ошибка
    if (imperfectRiddle) {
      console.warn(`[${formatTime()}] ⚠ Используем неидеальную загадку (слово: "${imperfectRiddle.word}")`);
      return imperfectRiddle;
    }

    throw lastError;
  }
}

RiddleGenerator.parseRiddle = parseRiddle;
RiddleGenerator.validateRiddle = validateRiddle;

module.exports = RiddleGenerator;
