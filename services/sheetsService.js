import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import dotenv from 'dotenv';
dotenv.config();
import { logger } from '../logger.js';

const SHEET_ID = process.env.SHEET_ID;
const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
if (!rawPrivateKey) {
  throw new Error(
    '❌ GOOGLE_PRIVATE_KEY não está definida nas variáveis de ambiente.',
  );
}
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_EMAIL,
  key: rawPrivateKey.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Module-level cached objects to avoid repeated loadInfo() calls which count as reads
let _cachedDoc = null;
let _cachedSheet = null;

// Buffer for batching writes (reduces number of API calls)
const writeBuffer = [];
let flushTimer = null;
const MAX_BATCH_SIZE = 20; // write up to 20 rows in a single request
const FLUSH_INTERVAL_MS = 600; // flush every 600ms if there are rows

async function ensureSheet(retry = 0) {
  if (_cachedSheet) return _cachedSheet;
  try {
    if (!_cachedDoc) {
      _cachedDoc = new GoogleSpreadsheet(SHEET_ID, auth);
      await _cachedDoc.loadInfo();
    } else if (!_cachedDoc.sheetsByIndex || !_cachedDoc.sheetsByIndex.length) {
      await _cachedDoc.loadInfo();
    }
    _cachedSheet = _cachedDoc.sheetsByIndex[0];
    return _cachedSheet;
  } catch (erro) {
    // Retry até 2 vezes antes de logar erro
    if (retry < 2) {
      await new Promise((r) => setTimeout(r, 300 + 200 * retry));
      return ensureSheet(retry + 1);
    }
    // Só loga erro se realmente falhar após os retries
    logger.error(`Erro conectando ao Google Sheets: ${erro.message}`);
    throw erro;
  }
}

async function conectarSheets() {
  // backward-compatible: return the loaded GoogleSpreadsheet doc
  if (!_cachedDoc) {
    _cachedDoc = new GoogleSpreadsheet(SHEET_ID, auth);
    await _cachedDoc.loadInfo();
  }
  return _cachedDoc;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushWriteBuffer().catch((e) =>
      logger.error(`Erro no flush do buffer: ${e.message}`),
    );
  }, FLUSH_INTERVAL_MS);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function attemptAddRows(sheet, rows, attempt = 1) {
  const maxAttempts = 5;
  try {
    // addRows will create fewer API calls than addRow in a loop
    await sheet.addRows(rows);
    return true;
  } catch (err) {
    const errMsg = (err && err.message) || String(err);
    const isQuota =
      errMsg.includes('Quota') || (err.statusCode && err.statusCode === 429);
    const isServerError = err.statusCode && err.statusCode >= 500;
    if ((isQuota || isServerError) && attempt < maxAttempts) {
      const backoff = Math.min(60000, 200 * Math.pow(2, attempt));
      const jitter = Math.floor(Math.random() * 200);
      logger.warn(
        `Sheets write attempt ${attempt} failed (will retry in ${
          backoff + jitter
        }ms): ${errMsg}`,
      );
      await sleep(backoff + jitter);
      return attemptAddRows(sheet, rows, attempt + 1);
    }
    // If it's a client error (bad payload) or max attempts reached, log and return false
    logger.error(`Erro ao registrar dados no Google Sheets: ${errMsg}`);
    return false;
  }
}

async function flushWriteBuffer(forceLog = false) {
  if (writeBuffer.length === 0) return;
  const sheet = await ensureSheet();
  // take up to MAX_BATCH_SIZE rows
  const batch = writeBuffer.splice(0, MAX_BATCH_SIZE);
  const toSave = batch;
  if (toSave.length === 0) return;
  const success = await attemptAddRows(sheet, toSave);
  if (success) {
    for (const r of toSave) {
      if (forceLog) {
        logger.info(
          `📊 Registro no Google Sheets: ✅ Sucesso para o Pedido ID ${
            r.orderId ?? '-'
          }`,
        );
      }
    }
  }
  if (writeBuffer.length > 0) scheduleFlush();
}

/**
 * Registrar row(s) no Google Sheets. This function buffers writes and flushes
 * them in batches to reduce the number of read requests and avoid 429 quota.
 * Accepts either a single object or an array of objects.
 */
async function registrarNoGoogleSheets(dados) {
  try {
    const rows = Array.isArray(dados) ? dados : [dados];
    const seenOrderIds = new Set();
    for (const r of rows) {
      const normalized = {
        // Keep orderId null when missing to avoid deduplication collisions
        orderId: r?.orderId ?? null,
        externalId: r?.externalId ?? '-',
        user: r?.user ?? '-',
        link: r?.link ?? '-',
        // Use '-' when startCount is not provided so Sheets shows a clear marker
        startCount: r?.startCount ?? '-',
        quantity: r?.quantity ?? '-',
        serviceId: r?.serviceId ?? '-',
        serviceName: r?.serviceName ?? '-',
        status: r?.status ?? '-',
        remains: r?.remains ?? '-',
        createdAt: r?.createdAt ?? '-',
        provider: r?.provider ?? '-',
        mensagemDoCliente: r?.mensagemDoCliente ?? '-',
        // Remove HTML tags, collapse newlines/spaces and truncate for safety
        mensagemDoClienteClean: r?.mensagemDoCliente
          ? r.mensagemDoCliente
              .replace(/<[^>]*>/g, '')
              .replace(/\n/g, ' ')
              .trim()
              .substring(0, 4000)
          : '-',
        // Keep lastMessage and include tipoSolicitacao followed by acao_realizada
        tipoSolicitacao: r?.tipoSolicitacao ?? '-',
        acao_realizada: r?.acao_realizada ?? '-',
        lastMessage: r?.lastMessage ?? '-',
        // raw_cancel_response can be large; it's truncated by the caller but keep it for audit
        raw_cancel_response: r?.raw_cancel_response ?? '-',
        http_status_cancel: r?.http_status_cancel ?? '-',
        subject: r?.subject ?? '-',
      };
      // Deduplica apenas dentro do lote atual
      if (normalized.orderId && seenOrderIds.has(normalized.orderId)) {
        continue;
      }
      if (normalized.orderId) {
        seenOrderIds.add(normalized.orderId);
      }
      writeBuffer.push(normalized);
    }
    if (writeBuffer.length >= MAX_BATCH_SIZE) {
      // Não faz flush automático, só agenda
      scheduleFlush();
    } else {
      scheduleFlush();
    }
  } catch (erro) {
    logger.error(
      `Erro ao enfileirar dados para Google Sheets: ${erro.message}`,
    );
  }
}

// expose a manual flush for tests or graceful shutdown
async function flushPendingWrites() {
  try {
    while (writeBuffer.length > 0) {
      await flushWriteBuffer(true); // Força log apenas quando chamado explicitamente
    }
  } catch (e) {
    logger.error(`Erro flushPendingWrites: ${e.message}`);
  }
}

export { registrarNoGoogleSheets, conectarSheets, flushPendingWrites };
