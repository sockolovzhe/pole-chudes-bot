const registerHostHandlers = require('./host');
const registerPlayHandlers = require('./play');
const registerInfoHandlers = require('./info');
const { registerRatingHandlers } = require('./rating');
const registerTextInputHandler = require('./textInput');

// Зарегистрировать все команды и кнопки бота
function registerHandlers(bot, deps) {
  registerHostHandlers(bot, deps);
  registerPlayHandlers(bot, deps);
  registerInfoHandlers(bot, deps);
  registerRatingHandlers(bot, deps);
  // Обработчик ответов на подсказки — последним, чтобы не перехватывать команды
  registerTextInputHandler(bot, deps);
}

module.exports = registerHandlers;
