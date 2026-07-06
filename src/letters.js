// Работа с буквами: нормализация и подсчёт вхождений

const SINGLE_LETTER_REGEX = /^[А-Яа-яЁёA-Za-z]$/;
const WORD_REGEX = /^[А-Яа-яЁёA-Za-z\s-]+$/;
const HAS_LETTER_REGEX = /[А-Яа-яЁёA-Za-z]/;

// Разделители внутри слова — открыты сразу и не участвуют в угадывании
function isSeparator(ch) {
  return ch === ' ' || ch === '-';
}

// Нормализовать символ для сравнения: Й = И, Ё = Е
function normalizeChar(ch) {
  if (!ch) return ch;
  const up = ch.toUpperCase();
  if (up === 'Й') return 'И';
  if (up === 'Ё') return 'Е';
  return up;
}

// Нормализовать строку для сравнения (лишние пробелы, регистр, Й→И, Ё→Е).
// Тире приравнивается к пробелу: "ЧТО НИБУДЬ" засчитывается за "ЧТО-НИБУДЬ"
function normalizeString(s) {
  return s
    .replace(/-/g, ' ')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/Й/g, 'И')
    .replace(/Ё/g, 'Е');
}

// Количество вхождений нормализованной буквы в слове (разделители игнорируются)
function countOccurrences(word, normLetter) {
  let count = 0;
  for (const ch of word) {
    if (!isSeparator(ch) && normalizeChar(ch) === normLetter) count++;
  }
  return count;
}

module.exports = { SINGLE_LETTER_REGEX, WORD_REGEX, HAS_LETTER_REGEX, isSeparator, normalizeChar, normalizeString, countOccurrences };
