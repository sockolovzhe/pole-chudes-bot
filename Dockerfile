FROM node:18-alpine

WORKDIR /app

# Копируем package.json и package-lock.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем все файлы приложения
COPY . .

# Запускаем бота
CMD ["node", "bot.js"]
