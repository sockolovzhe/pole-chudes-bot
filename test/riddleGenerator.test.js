const { test } = require('node:test');
const assert = require('node:assert/strict');
const RiddleGenerator = require('../src/riddleGenerator');

const { parseRiddle, validateRiddle, maskWordInText } = RiddleGenerator;

// Тесты генерации не должны ходить в сеть: calend.ru всегда «недоступен»
globalThis.fetch = async () => { throw new Error('сеть отключена в тестах'); };

function aiResponse(word, body = 'Факты о празднике.') {
  return `🎩 Приветствие 🎉\n\n${body}\n\nИтак, внимание, вопрос! Что это?\n\nЗАГАДАННОЕ_СЛОВО: ${word}\n\nСЛОВО: _ _ _\n\nТЕМА_ДЛЯ_КАРТИНКИ: test theme`;
}

test('parseRiddle извлекает слово и тему, чистит служебные строки', () => {
  const riddle = parseRiddle(aiResponse('Тукуман'));
  assert.equal(riddle.word, 'ТУКУМАН');
  assert.equal(riddle.imageTheme, 'test theme');
  assert.ok(!riddle.riddleText.includes('ЗАГАДАННОЕ_СЛОВО'));
  assert.ok(!riddle.riddleText.includes('ТЕМА_ДЛЯ_КАРТИНКИ'));
  assert.ok(!/^СЛОВО:/m.test(riddle.riddleText));
});

test('parseRiddle склеивает слово в разрядку, но не двухсловные ответы', () => {
  assert.equal(parseRiddle(aiResponse('А Н А Х И Т А')).word, 'АНАХИТА');
  assert.equal(parseRiddle(aiResponse('АЛЬФРЕД НОБЕЛЬ')).word, 'АЛЬФРЕД НОБЕЛЬ');
  assert.equal(parseRiddle(aiResponse('ПРО_БЕЛ')).word, 'ПРО БЕЛ');
});

test('parseRiddle бросает ошибку без слова', () => {
  assert.throws(() => parseRiddle('просто текст без служебных строк'));
});

test('validateRiddle отклоняет короткие, длинные и многословные ответы', () => {
  assert.match(validateRiddle({ word: 'ЧАЙ', riddleText: '' }).reason, /короткое/);
  assert.match(validateRiddle({ word: 'ОЧЕНЬ ДЛИННОЕ СЛОВОСОЧЕТАНИЕ', riddleText: '' }).reason, /длинное/);
  assert.match(validateRiddle({ word: 'РАЗ ДВА ТРИ ЧЕТЫРЕ', riddleText: '' }).reason, /больше двух/);
  assert.equal(validateRiddle({ word: 'ТУКУМАН', riddleText: 'чистый текст' }), null);
});

test('validateRiddle ловит ответ в тексте в любом склонении', () => {
  const problem = validateRiddle({ word: 'ТУКУМАН', riddleText: 'конгресс собрался в Тукумане' });
  assert.ok(problem);
  assert.equal(problem.canFallback, true);
});

test('maskWordInText маскирует все словоформы ответа', () => {
  const masked = maskWordInText('В Тукумане решили, что Тукуман велик', 'ТУКУМАН');
  assert.ok(!/тукум/i.test(masked));
  assert.ok(masked.includes('███'));
  // Слово не в тексте — текст не меняется
  assert.equal(maskWordInText('чистый текст', 'ВОЛЬФРАМ'), 'чистый текст');
});

test('buildPrompt: праздники с описаниями и запрет отклонённых слов', () => {
  const gen = new RiddleGenerator({});
  const prompt = gen.buildPrompt(
    [{ name: 'День теста', description: 'Описание праздника.' }],
    ['ТУКУМАН']
  );
  assert.ok(prompt.includes('День теста'));
  assert.ok(prompt.includes('Описание праздника.'));
  assert.ok(prompt.includes('"ТУКУМАН"'));
  assert.ok(prompt.includes('уже отклонил'));

  // Без праздников — фолбэк на знания модели
  const fallback = gen.buildPrompt(null);
  assert.ok(fallback.includes('Определи, какие сегодня'));
});

test('generateDailyRiddle отбрасывает отклонённые ведущим слова', async () => {
  const words = ['ТУКУМАН', 'ТУКУМАН', 'РОДОХРОЗИТ'];
  let call = 0;
  const gen = new RiddleGenerator({
    generateTextFn: async () => ({ text: aiResponse(words[Math.min(call++, words.length - 1)]) }),
  });
  gen.providers = [{ name: 'stub', model: null }];

  const riddle = await gen.generateDailyRiddle(['ТУКУМАН']);
  assert.equal(riddle.word, 'РОДОХРОЗИТ');
  assert.equal(call, 3);
});

test('generateDailyRiddle: спойлер уходит в запас и переписывается', async () => {
  let call = 0;
  const gen = new RiddleGenerator({
    generateTextFn: async () => {
      call++;
      // Все попытки генерации — со спойлером; переписывание (последний вызов) чистое
      if (call <= 6) return { text: aiResponse('ТУКУМАН', 'Конгресс собрался в Тукумане.') };
      return { text: '🎩 Приветствие 🎉\n\nКонгресс собрался в этом городе.\n\nИтак, внимание, вопрос! Что это?' };
    },
  });
  gen.providers = [{ name: 'stub', model: null }];

  const riddle = await gen.generateDailyRiddle();
  assert.equal(riddle.word, 'ТУКУМАН');
  assert.ok(!/тукум/i.test(riddle.riddleText), 'спойлер должен быть переписан');
});

test('removeSpoiler: если переписать не удалось — маскирует ███', async () => {
  const gen = new RiddleGenerator({
    generateTextFn: async () => ({ text: 'Всё ещё говорим про Тукуман!' }),
  });
  gen.providers = [{ name: 'stub', model: null }];

  const fixed = await gen.removeSpoiler({ word: 'ТУКУМАН', riddleText: 'Речь про Тукуман.' });
  assert.ok(!/тукум/i.test(fixed.riddleText));
  assert.ok(fixed.riddleText.includes('███'));
});
