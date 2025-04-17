const winston = require('winston');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');
const DailyRotateFile = require('winston-daily-rotate-file');

// Variável para armazenar a janela do Electron que receberá os logs
let sendToWindow = null;

// Diretório onde os logs serão armazenados
const logDir = path.join(app.getPath('userData'), 'logs');

// Garante que o diretório existe
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Formato do log
const logFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

// Criando o logger com Winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    new DailyRotateFile({
      filename: path.join(logDir, 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '15m',
      maxFiles: '7d',
    }),
    new winston.transports.Console(),
  ],
});

// 👉 Função para definir a janela do Electron que receberá os logs
function setSender(window) {
  sendToWindow = window;
}

// 👉 Função genérica para enviar logs para o frontend
function sendToRenderer(level, message) {
  if (sendToWindow && sendToWindow.webContents) {
    sendToWindow.webContents.send(
      'update-terminal',
      `[${level.toUpperCase()}] ${message}`,
    );
  } else {
    console.log(`[${level.toUpperCase()}] ${message}`); // Se a janela não estiver disponível, loga no console
  }
}

// 👉 Sobrescrevendo os métodos padrão do logger para também enviar ao frontend
['info', 'warn', 'error', 'debug'].forEach((level) => {
  const original = logger[level].bind(logger);
  logger[level] = (...args) => {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');

    original(message);
    sendToRenderer(level, message);
  };
});

// 👉 log() = atalho para logger.info()
function log(...args) {
  logger.info(...args);
}

module.exports = {
  setSender,
  log,
  logger,
};
