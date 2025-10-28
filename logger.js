import winston from 'winston';
import path from 'path';
import fs from 'fs';
import DailyRotateFile from 'winston-daily-rotate-file';

// Tenta importar 'app' do Electron, se disponível
let logDir;
try {
  const { app } = await import('electron');
  logDir = path.join(app.getPath('userData'), 'logs');
} catch (e) {
  // Fallback para pasta local se Electron não estiver disponível
  logDir = path.join(process.cwd(), 'logs');
}
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
});
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat,
  ),
  transports: [
    // Removido: gravação automática do app-%DATE%.log
    new winston.transports.Console(),
  ],
});
let sendToWindow = null;
function setSender(window) {
  sendToWindow = window;
}
function sendToRenderer(level, message) {
  if (sendToWindow && sendToWindow.webContents) {
    sendToWindow.webContents.send(
      'update-terminal',
      `[${level.toUpperCase()}] ${message}`,
    );
  } else {
    // No-op in backend puro
  }
}
['info', 'warn', 'error', 'debug'].forEach((level) => {
  const original = logger[level].bind(logger);
  logger[level] = (...args) => {
    const message = args
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');
    original(message);
    sendToRenderer(level, message);
    // Adiciona ao log do ticket se estiver processando
    if (typeof global !== 'undefined' && global.appendTicketLog) {
      global.appendTicketLog(
        `${new Date().toISOString()} [${level.toUpperCase()}]: ${message}`,
      );
    }
  };
});
// Garante que appendTicketLog esteja disponível globalmente
if (typeof global !== 'undefined') {
  global.appendTicketLog = appendTicketLog;
}
function log(...args) {
  logger.info(...args);
}

// --- LOG DE TICKETS INDIVIDUAIS ---
let currentTicketLog = null;
let currentTicketId = null;
let currentTicketUser = null;
let currentTicketOrderIds = null;
let currentTicketLogs = [];

function startTicketLog(ticketId, user, orderIds) {
  if (currentTicketLog) finishTicketLog();
  currentTicketId = ticketId;
  currentTicketUser = user;
  currentTicketOrderIds = orderIds;
  currentTicketLogs = [];
}

function appendTicketLog(message) {
  if (currentTicketId) {
    // Formata data/hora para o Brasil (DD/MM/YYYY HH:mm:ss)
    const now = new Date();
    const brDate = now.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour12: false,
    });
    currentTicketLogs.push({ timestamp: brDate, message });
  }
}

function finishTicketLog() {
  if (!currentTicketId) return;
  const logText = currentTicketLogs
    .map(
      (l) =>
        `[${l.timestamp}] ${l.message.replace(
          /^\d{4}-\d{2}-\d{2}T.*?\[([A-Z]+)\]:/,
          '[$1]:',
        )}`,
    )
    .join('\n');
  const now = new Date();
  const dateFolder = `${String(now.getDate()).padStart(2, '0')}-${String(
    now.getMonth() + 1,
  ).padStart(2, '0')}-${now.getFullYear()}`;
  const logDir = path.join(process.cwd(), 'logs', 'tickets', dateFolder);
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const filePathLog = path.join(logDir, `ticket_${currentTicketId}.log`);
  fs.writeFileSync(filePathLog, logText, 'utf-8');
  // Salvamento local apenas (Google Drive removido)
  try {
    logger.info(`✅ Log salvo localmente em ${filePathLog}`);
  } catch (e) {
    console.error('Erro ao registrar salvamento de log local:', e.message);
  }
  currentTicketId = null;
  currentTicketUser = null;
  currentTicketOrderIds = null;
  currentTicketLogs = [];
}

export {
  setSender,
  log,
  logger,
  startTicketLog,
  appendTicketLog,
  finishTicketLog,
};
