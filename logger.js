const winston = require('winston');
const path = require('path');
const DailyRotateFile = require('winston-daily-rotate-file');

// Configurando o formato do log
const logFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});

// Criando o logger
const logger = winston.createLogger({
  level: 'info', // Define o nível mínimo de log que será salvo
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    // Configuração de rotação de log para manter apenas 1000 logs
    new DailyRotateFile({
      filename: path.join(__dirname, 'logs', 'app-%DATE%.log'), // Define o nome do arquivo de log com data
      datePattern: 'YYYY-MM-DD', // Formato da data no nome do arquivo
      maxFiles: '3d', // Mantém logs por 1 dia
      maxSize: '15m', // Limita o tamanho do arquivo de log a 20MB
      maxFiles: '7', // Mantém 7 arquivos de log (pode ajustar conforme necessidade)
    }),

    // Exibe os logs no terminal
    new winston.transports.Console(),
  ],
});

module.exports = logger;
