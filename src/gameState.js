const { isSeparator, normalizeChar, normalizeString, countOccurrences } = require('./letters');

// Состояние игры в одном чате
class GameState {
  constructor() {
    this.word = ''; // Загаданное слово
    this.hostId = null; // ID ведущего
    this.players = []; // Список участников: { id, username, isActive }
    this.currentPlayerIndex = -1; // Индекс текущего игрока (-1 — ещё никто не ходил)
    this.guessedLetters = new Set(); // Угаданные буквы (нормализованные)
    this.attemptedLetters = new Set(); // Все попытанные буквы (угаданные и нет)
    this.isActive = false; // Активна ли игра
    this.scores = new Map(); // Очки игроков (userId -> score)
    this.letterPoints = new Map(); // Базовые очки за каждую букву (letter -> points)
    this.hasWinner = true; // false, если все игроки выбыли
  }

  // Сбросить состояние раунда (игроки и ведущий не трогаются)
  reset() {
    this.word = '';
    this.isActive = false;
    this.currentPlayerIndex = -1;
    this.guessedLetters.clear();
    this.attemptedLetters.clear();
    this.scores.clear();
    this.letterPoints.clear();
    this.hasWinner = true;
  }

  // Загадать новое слово (очки и попытки сбрасываются, игроки остаются)
  setWord(word) {
    this.word = word;
    this.isActive = true;
    this.currentPlayerIndex = -1;
    this.guessedLetters.clear();
    this.attemptedLetters.clear();
    this.scores.clear();
    this.letterPoints.clear();
  }

  // Случайные очки за букву: 100-1000, кратно 100
  generatePoints() {
    return (Math.floor(Math.random() * 10) + 1) * 100;
  }

  addPoints(userId, points) {
    const currentScore = this.scores.get(userId) || 0;
    this.scores.set(userId, currentScore + points);
    return this.scores.get(userId);
  }

  getPlayerScore(userId) {
    return this.scores.get(userId) || 0;
  }

  // Таблица очков, отсортированная по убыванию
  getScoresTable() {
    return Array.from(this.scores.entries())
      .map(([userId, score]) => {
        const player = this.players.find(p => p.id === userId);
        return { userId, username: player?.username || 'неизвестно', score };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Текущее отображение слова (неугаданные буквы — █, разделители открыты сразу)
  getDisplayWord() {
    return this.word
      .split('')
      .map(letter => {
        if (letter === ' ') return '   ';
        if (letter === '-') return ' - ';
        if (this.guessedLetters.has(normalizeChar(letter))) {
          return ` ${letter.toUpperCase()} `;
        }
        return ' █ ';
      })
      .join('');
  }

  isComplete() {
    return !this.getDisplayWord().includes('█');
  }

  // Попытка угадать букву
  guessLetter(letter, userId) {
    const upperLetter = letter.toUpperCase();
    const normLetter = normalizeChar(upperLetter);

    if (this.guessedLetters.has(normLetter)) {
      return { success: false, message: 'Эта буква уже была угадана!', alreadyTried: true };
    }

    const wasAttemptedBefore = this.attemptedLetters.has(normLetter);
    this.attemptedLetters.add(normLetter);

    const letterCount = countOccurrences(this.word, normLetter);

    if (letterCount === 0) {
      if (wasAttemptedBefore) {
        return { success: false, message: `Буквы "${upperLetter}" нет в слове (уже пробовали).`, alreadyTried: true };
      }
      return { success: false, message: `Буквы "${upperLetter}" нет в слове.`, alreadyTried: false };
    }

    this.guessedLetters.add(normLetter);

    const basePoints = this.generatePoints();
    const totalPoints = basePoints * letterCount;
    this.saveLetterPoints(normLetter, basePoints);
    const newTotal = this.addPoints(userId, totalPoints);

    let message = `Буква "${upperLetter}" есть в слове!`;
    if (letterCount > 1) {
      message += ` (встречается ${letterCount} раз${letterCount >= 2 && letterCount <= 4 ? 'а' : ''})`;
    }

    return {
      success: true,
      message,
      isComplete: this.isComplete(),
      points: totalPoints,
      basePoints,
      letterCount,
      totalScore: newTotal,
    };
  }

  // Угадать слово (или фразу) целиком
  guessWord(guessedWord, userId) {
    if (normalizeString(guessedWord) !== normalizeString(this.word)) {
      return { success: false, message: `❌ Неправильно! Это не то слово.` };
    }

    // Начисляем очки за ещё не угаданные буквы (уникальные, с учётом вхождений)
    const uniqueNewLetters = new Set();
    for (const ch of this.word) {
      if (isSeparator(ch)) continue;
      const norm = normalizeChar(ch);
      if (!this.guessedLetters.has(norm)) uniqueNewLetters.add(norm);
    }

    let totalPoints = 0;
    for (const normLetter of uniqueNewLetters) {
      const basePoints = this.generatePoints();
      totalPoints += basePoints * countOccurrences(this.word, normLetter);
      this.saveLetterPoints(normLetter, basePoints);
      this.guessedLetters.add(normLetter);
    }

    // Детальная статистика по уникальным буквам слова (в порядке первого появления)
    const letterPointsDetails = [];
    const seenLetters = new Set();
    for (const ch of this.word) {
      if (isSeparator(ch)) continue;
      const norm = normalizeChar(ch);
      if (seenLetters.has(norm)) continue;
      seenLetters.add(norm);

      const basePoints = this.letterPoints.get(norm) || 0;
      const letterCount = countOccurrences(this.word, norm);
      const detail = { letter: norm, basePoints, letterCount, totalPoints: basePoints * letterCount };
      if (!uniqueNewLetters.has(norm)) detail.alreadyGuessed = true;
      letterPointsDetails.push(detail);
    }

    // Бонус 1/3 от очков за новые буквы всегда начисляется при угадывании слова
    const bonus = Math.floor(totalPoints / 3);
    const finalPoints = totalPoints + bonus;
    const newTotal = this.addPoints(userId, finalPoints);

    const isPhrase = this.word.trim().split(/\s+/).length > 1;

    return {
      success: true,
      message: isPhrase
        ? `🎉 Правильно! Фраза "${this.word}" угадана!`
        : `🎉 Правильно! Слово "${this.word}" угадано!`,
      points: finalPoints,
      basePoints: totalPoints,
      bonus,
      totalScore: newTotal,
      letterPointsDetails,
      guessedWord: this.word,
    };
  }

  // Запомнить базовые очки за букву (при повторе берём максимум) — для итоговой статистики
  saveLetterPoints(normLetter, basePoints) {
    if (!this.letterPoints.has(normLetter) || this.letterPoints.get(normLetter) < basePoints) {
      this.letterPoints.set(normLetter, basePoints);
    }
  }

  // Детальная статистика очков за все буквы слова
  getLetterPointsDetails() {
    const details = [];
    const seenLetters = new Set();

    for (const ch of this.word) {
      if (isSeparator(ch)) continue;
      const norm = normalizeChar(ch);
      if (seenLetters.has(norm)) continue;
      seenLetters.add(norm);

      const basePoints = this.letterPoints.get(norm) || 0;
      const letterCount = countOccurrences(this.word, norm);
      details.push({ letter: norm, basePoints, letterCount, totalPoints: basePoints * letterCount });
    }

    return details;
  }

  // Буквы, которые называли, но их нет в слове
  getWrongLetters() {
    const lettersInWord = new Set();
    for (const ch of this.word) {
      if (!isSeparator(ch)) lettersInWord.add(normalizeChar(ch));
    }

    return Array.from(this.attemptedLetters)
      .filter(letter => !lettersInWord.has(letter))
      .sort();
  }

  // Добавить игрока (ведущий не участвует)
  addPlayer(userId, username) {
    if (userId === this.hostId) return;
    if (!this.players.find(p => p.id === userId)) {
      this.players.push({ id: userId, username: username || `Игрок ${this.players.length + 1}`, isActive: true });
      if (!this.scores.has(userId)) {
        this.scores.set(userId, 0);
      }
    }
  }

  // Исключить игрока из очереди ходов (остаётся в игре для статистики)
  excludePlayerFromTurns(userId) {
    const player = this.players.find(p => p.id === userId);
    if (!player) return false;

    player.isActive = false;
    const currentPlayer = this.getCurrentPlayer();
    if (currentPlayer && currentPlayer.id === userId) {
      this.passTurnToNext();
    }
    return true;
  }

  getActivePlayers() {
    return this.players.filter(p => p.isActive);
  }

  getCurrentPlayer() {
    if (this.players.length === 0 || this.currentPlayerIndex === -1) return null;
    return this.players[this.currentPlayerIndex];
  }

  // Передать ход следующему активному игроку
  passTurnToNext() {
    if (this.players.length === 0) return null;

    let nextIndex = (this.currentPlayerIndex + 1) % this.players.length;
    for (let attempts = 0; attempts < this.players.length; attempts++) {
      if (this.players[nextIndex].isActive) {
        this.currentPlayerIndex = nextIndex;
        return this.players[nextIndex];
      }
      nextIndex = (nextIndex + 1) % this.players.length;
    }

    return null; // Нет активных игроков
  }
}

module.exports = GameState;
