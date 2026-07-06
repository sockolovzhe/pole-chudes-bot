require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}`);
  }
  return value;
}

// Локально Mongo доступна на внешнем порту из docker-compose (27999),
// внутри docker-сети — на 27017 (задаётся в docker-compose.production.yml)
const mongoPort = process.env.MONGO_PORT || '27017';

module.exports = {
  botToken: required('BOT_TOKEN'),
  mongoUri: `mongodb://${required('MONGO_ADMIN')}:${required('MONGO_PASSWORD')}@${required('MONGO_HOST')}:${mongoPort}/pole-chudes-bot?authSource=admin`,
  groqApiKey: process.env.GROQ_API_KEY,
};
