import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { logger } from '../logger.js';
import { registrarNoGoogleSheets, conectarSheets } from './sheetsService.js';
import config from '../config.js';
import dotenv from 'dotenv';
dotenv.config();

// Substitui __dirname por URL compatível com ES Modules
const __filename = new URL('', import.meta.url).pathname;
// Corrigir __dirname para funcionar corretamente no Windows/ESM
const __dirname = path
  .dirname(new URL(import.meta.url).pathname)
  .replace(/^\\|^\//, '');

// Arquivo onde a última execução será salva
const LAST_EXECUTION_FILE = path.resolve(__dirname, 'last_execution.json');

// Arquivo onde as mensagens do ticket serão salvas
const MESSAGES_LOG_PATH = path.join(__dirname, 'messages_logs');
const MESSAGES_LOG_FILE = path.join(
  MESSAGES_LOG_PATH,
  'ticket_messages_log.txt',
);

// Centralize variáveis de ambiente usando config
const API_KEY = config.API_KEY;
const TICKET_API_BASE_URL = config.ticketAPIBaseURL;
const ORDER_API_BASE_URL = config.ticketAPIBaseURL;
// Admin API base (for resend / cancel endpoints)
const ADMIN_API_BASE_URL = process.env.ADMIN_API_BASE_URL || '';

// Padronize headers para requisições
function getApiHeaders() {
  return { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
}

// Função para realizar requisições HTTP com tentativas e timeout
async function requestWithRetry(
  url,
  method = 'GET',
  data = null,
  retries = 3,
  timeout = 10000,
  headers = getApiHeaders(),
  // when true, return the full axios response (status, headers, data)
  returnFullResponse = false,
) {
  let error = null;
  while (retries > 0) {
    try {
      const response = await axios({
        method,
        url,
        data,
        headers,
        timeout,
      });
      return returnFullResponse ? response : response.data;
    } catch (e) {
      error = e;
      retries -= 1;
      logger.error(
        `Erro ao fazer requisição para ${url}: ${e.message}. Tentativas restantes: ${retries}`,
      );
      if (retries === 0) {
        logger.error(
          `Falha ao realizar requisição para ${url} após várias tentativas.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Espera de 3 segundos
    }
  }
  throw error; // Caso todas as tentativas falhem
}

// Função para buscar um ticket específico usando seu ID
async function buscarTicket(ticketId) {
  try {
    const data = await requestWithRetry(
      `${TICKET_API_BASE_URL}/tickets/${ticketId}`,
    );
    return data?.data || null; // Retorna os dados do ticket
  } catch (error) {
    logger.error(`Erro ao buscar ticket com ID ${ticketId}: ${error.message}`);
    return null;
  }
}

// Função para verificar se o pedido já foi cancelado
async function verificarCancelamento(orderId) {
  try {
    const data = await requestWithRetry(
      `${ORDER_API_BASE_URL}/orders/${orderId}`,
    );
    return data?.data?.status === 'canceled'; // Retorna verdadeiro se o pedido foi cancelado
  } catch (error) {
    logger.error(
      `Erro ao verificar cancelamento do pedido ${orderId}: ${error.message}`,
    );
    return false; // Retorna falso caso haja erro
  }
}

// Função para responder ao cliente no ticket
async function responderTicket(ticketId, mensagem) {
  try {
    const staffName = 'marceloblueocean'; // Nome do atendente que está respondendo ao ticket

    if (!mensagem || mensagem.trim().length === 0) {
      logger.error(`Erro: A mensagem não pode estar vazia.`);
      return null;
    }
    // Loga o corpo da requisição antes de enviar
    logger.info(
      `[DEBUG] Enviando resposta ao ticket ${ticketId}: staff_name=${staffName}, message=${mensagem}`,
    );
    try {
      const resposta = await axios.post(
        `${TICKET_API_BASE_URL}/tickets/${ticketId}/reply`,
        { staff_name: staffName, message: mensagem },
        { headers: getApiHeaders() },
      );
      return resposta.data;
    } catch (erro) {
      // Loga a resposta de erro da API, se disponível
      if (erro.response) {
        logger.error(
          `Erro ao responder ao ticket ${ticketId}: ${erro.message} | status: ${
            erro.response.status
          } | data: ${JSON.stringify(erro.response.data)}`,
        );
      } else {
        logger.error(
          `Erro ao responder ao ticket ${ticketId}: ${erro.message}`,
        );
      }
      return null;
    }
  } catch (erro) {
    logger.error(`Erro ao responder ao ticket ${ticketId}: ${erro.message}`);
    return null;
  }
}

// Função para extrair o Order ID das mensagens
function extrairOrderIdDaMensagem(messages) {
  for (let msg of messages) {
    if (
      msg.message &&
      typeof msg.message === 'string' &&
      msg.message.trim() !== ''
    ) {
      // Regex refinado para evitar falsos positivos (apenas números de 6 a 10 dígitos)
      const match = msg.message.match(/\b\d{6,10}\b/);
      if (match) return match[0]; // Retorna o primeiro ID encontrado
    }
  }
  return null;
}

// Função para buscar os dados do pedido
async function buscarStatusPedido(orderId) {
  try {
    const orderApiUrl = `${ORDER_API_BASE_URL}/orders/${orderId}`;
    logger.info(`[DEBUG] Buscando status do pedido na URL: ${orderApiUrl}`);
    const resposta = await axios.get(orderApiUrl, {
      headers: getApiHeaders(),
    });
    const dadosPedido = resposta.data?.data;
    return {
      orderId: dadosPedido.id,
      externalId: dadosPedido.external_id,
      user: dadosPedido.user,
      link: dadosPedido.link,
      startCount: dadosPedido.start_count,
      quantity: dadosPedido.quantity, // Corrigido para acessar diretamente a quantidade
      serviceId: dadosPedido.service_id,
      serviceName: dadosPedido.service_name,
      status: dadosPedido.status,
      remains: dadosPedido.remains,
      createdAt: dadosPedido.created,
      provider: dadosPedido.provider,
    };
  } catch (erro) {
    if (erro.response && erro.response.status === 404) {
      logger.info(`Pedido ID ${orderId} não encontrado na API (404).`);
    } else {
      logger.error(
        `Erro ao buscar status do pedido ${orderId}: ${erro.message}`,
      );
      if (erro.config) logger.error(`[DEBUG] URL usada: ${erro.config.url}`);
    }
    return null;
  }
}

// Função para listar tickets
async function listarTickets(limite = 100) {
  try {
    const resposta = await axios.get(`${TICKET_API_BASE_URL}/tickets`, {
      headers: getApiHeaders(),
      params: {
        limit: limite,
        sort_by: 'created_at',
        order: 'desc',
        status: 'pending', // Buscar apenas tickets pendentes
      },
    });

    return resposta.data?.data?.list || [];
  } catch (erro) {
    logger.error(`Erro ao listar tickets: ${erro.message}`);
    return [];
  }
}

// Função para obter a hora da última execução (assíncrona)
async function obterUltimaExecucao() {
  try {
    const dados = await fs.promises.readFile(LAST_EXECUTION_FILE, 'utf8');
    return JSON.parse(dados).lastExecution;
  } catch (erro) {
    // Se não existir, inicializa com data/hora atual
    const now = new Date().toISOString();
    await fs.promises.writeFile(
      LAST_EXECUTION_FILE,
      JSON.stringify({ lastExecution: now }),
      'utf8',
    );
    return now;
  }
}

// Função para atualizar a hora da última execução (assíncrona)
async function atualizarUltimaExecucao() {
  const dataHoraAtual = new Date().toISOString();
  const dados = { lastExecution: dataHoraAtual };
  await fs.promises.writeFile(
    LAST_EXECUTION_FILE,
    JSON.stringify(dados),
    'utf8',
  );
  return dataHoraAtual;
}

// Função para salvar as mensagens no arquivo
async function salvarMensagensNoArquivo(
  ticketId,
  lastMessage,
  orderId,
  allMessages,
) {
  garantirDiretorio(); // Garante que o diretório existe antes de salvar
  logger.info(`Salvando no log - Order ID: ${orderId}`);

  const formattedMessage = removerTagsHTML(lastMessage);
  if (!formattedMessage) {
    logger.error(
      'Erro: A última mensagem está vazia ou não contém texto válido.',
    );
    return;
  }

  let orderStatus = 'Não disponível';
  if (orderId) {
    const orderData = await buscarStatusPedido(orderId);
    orderStatus = orderData ? orderData.status : 'Não disponível';
  }

  const finalMessage = `${new Date().toISOString()} - Ticket ID: ${ticketId}:  - Última Mensagem: "${formattedMessage}"\n - Status do Pedido: ${orderStatus}\n - Ordem ID: ${
    orderId || 'Não disponível'
  }\n - Mensagens:\n`;

  // Padronize para aceitar array de mensagens
  const formattedMessages = Array.isArray(allMessages)
    ? allMessages.map((msg) => removerTagsHTML(msg.trim())).join('\n')
    : removerTagsHTML(allMessages);

  const logMessage = finalMessage + formattedMessages;

  try {
    await fs.promises.appendFile(MESSAGES_LOG_FILE, logMessage, 'utf8');
    logger.info(`Mensagens do ticket salvas no arquivo: ${MESSAGES_LOG_FILE}`);
  } catch (erro) {
    logger.error(`Erro ao salvar mensagens no arquivo: ${erro.message}`);
  }
}

// Função para remover as tags HTML de uma string
function removerTagsHTML(texto) {
  return texto.replace(/<\/?[^>]+(>|$)/g, '').trim();
}

// Função para garantir que o diretório existe
function garantirDiretorio() {
  if (!fs.existsSync(MESSAGES_LOG_PATH)) {
    fs.mkdirSync(MESSAGES_LOG_PATH, { recursive: true });
  }
}

// Simple in-memory TTL cache to avoid re-querying the same Order ID repeatedly
const orderCache = new Map();
const DEFAULT_CACHE_TTL_MS =
  Number(process.env.ORDER_CACHE_TTL_MS) || 5 * 60 * 1000; // 5 minutes default

function getCachedOrder(id, ttl = DEFAULT_CACHE_TTL_MS) {
  const rec = orderCache.get(id);
  if (!rec) return undefined;
  if (Date.now() - rec.ts > ttl) {
    orderCache.delete(id);
    return undefined;
  }
  return rec.value;
}

function setCachedOrder(id, value) {
  orderCache.set(id, { value, ts: Date.now() });
}

/**
 * Busca múltiplos pedidos com limite de concorrência e um cap por ticket.
 * Retorna { found: [orderData], notFound: [ids], tooMany: boolean }
 */
async function buscarStatusPedidosConcurrently(orderIds = [], options = {}) {
  const {
    concurrency = 6,
    attempts = 3,
    perTicketLimit = 50,
    delayMs = 800,
  } = options;

  if (!Array.isArray(orderIds) || orderIds.length === 0)
    return { found: [], notFound: [], tooMany: false };

  if (orderIds.length > perTicketLimit) {
    logger.warn(
      `⚠️ Muitos Order IDs (${orderIds.length}) no mesmo ticket. Limite: ${perTicketLimit}`,
    );
    return { found: [], notFound: orderIds.slice(), tooMany: true };
  }

  const uniqIds = Array.from(new Set(orderIds.map((i) => String(i).trim())));
  const found = [];
  const notFound = [];

  // worker queue
  let idx = 0;
  let active = 0;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function fetchOne(id) {
    // check cache (with TTL)
    const cacheTTL = options.cacheTTL || DEFAULT_CACHE_TTL_MS;
    const cached = getCachedOrder(id, cacheTTL);
    if (cached !== undefined) {
      if (cached) found.push(cached);
      else notFound.push(id);
      return;
    }

    // attempts: on 404 we stop immediately; on other errors we retry
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const url = `${ORDER_API_BASE_URL}/orders/${id}`;
        logger.info(`[DEBUG] Buscando status do pedido na URL: ${url}`);
        const resp = await axios.get(url, {
          headers: getApiHeaders(),
          timeout: 10000,
        });
        const dadosPedido = resp.data?.data;
        const mapped = {
          orderId: dadosPedido.id,
          externalId: dadosPedido.external_id,
          user: dadosPedido.user,
          link: dadosPedido.link,
          startCount: dadosPedido.start_count,
          quantity: dadosPedido.quantity,
          serviceId: dadosPedido.service_id,
          serviceName: dadosPedido.service_name,
          status: dadosPedido.status,
          remains: dadosPedido.remains,
          createdAt: dadosPedido.created,
          provider: dadosPedido.provider,
        };
        setCachedOrder(id, mapped);
        found.push(mapped);
        return;
      } catch (err) {
        if (err.response && err.response.status === 404) {
          logger.info(`Pedido ID ${id} não encontrado na API (404).`);
          setCachedOrder(id, null);
          notFound.push(id);
          return;
        }
        logger.error(
          `Erro ao buscar pedido ${id} (attempt ${attempt}/${attempts}): ${err.message}`,
        );
        if (attempt < attempts) await sleep(delayMs);
      }
    }
    // all attempts failed for other errors
    logger.warn(`Pedido ID ${id} falhou após ${attempts} tentativas.`);
    setCachedOrder(id, null);
    notFound.push(id);
  }

  return new Promise((resolve) => {
    const runNext = async () => {
      while (active < concurrency && idx < uniqIds.length) {
        const current = uniqIds[idx++];
        active += 1;
        fetchOne(current)
          .catch((e) =>
            logger.error(`Erro inesperado ao buscar ${current}: ${e.message}`),
          )
          .finally(() => {
            active -= 1;
            // schedule next tick
            setImmediate(runNext);
          });
      }
      // finished condition
      if (active === 0 && idx >= uniqIds.length) {
        resolve({ found, notFound, tooMany: false });
      }
    };
    runNext();
  });
}

export {
  garantirDiretorio,
  buscarTicket,
  responderTicket,
  extrairOrderIdDaMensagem,
  buscarStatusPedido,
  buscarStatusPedidosConcurrently,
  listarTickets,
  obterUltimaExecucao,
  atualizarUltimaExecucao,
  salvarMensagensNoArquivo,
  removerTagsHTML,
  verificarCancelamento,
};

// Request cancellation for one or multiple order IDs (idsArray: array of strings/ints)
async function requestCancelOrders(idsArray = []) {
  if (!Array.isArray(idsArray) || idsArray.length === 0) {
    throw new Error('Nenhum ID fornecido para cancelamento');
  }
  const idsStr = idsArray
    .map((i) => String(i).trim())
    .filter(Boolean)
    .join(',');
  const url = `${ORDER_API_BASE_URL}/orders/request-cancel`;
  try {
    // Build the body. Keep `{ ids: '1,2,3' }` by default but allow adding
    // an extra field via environment variables for APIs that require a
    // confirmation/force flag (e.g. `{ ids: '1,2,3', confirm: true }`).
    const body = { ids: idsStr };

    // Optional env-driven extra field name and value. Example in .env:
    // CANCEL_EXTRA_FIELD=confirm
    // CANCEL_EXTRA_VALUE=true
    const extraField = process.env.CANCEL_EXTRA_FIELD;
    const extraValue = process.env.CANCEL_EXTRA_VALUE;
    if (extraField) {
      // convert common string values to booleans/numbers when appropriate
      let parsed = extraValue;
      if (typeof extraValue === 'string') {
        const low = extraValue.toLowerCase().trim();
        if (low === 'true') parsed = true;
        else if (low === 'false') parsed = false;
        else if (!isNaN(Number(low))) parsed = Number(low);
      }
      body[extraField] = parsed;
      logger.info(
        `ℹ️ Adicionando campo extra ao payload de cancelamento: ${extraField}=${parsed}`,
      );
    }

    // Request the full axios response so callers can inspect HTTP status/headers if needed
    const fullResp = await requestWithRetry(
      url,
      'POST',
      body,
      3,
      15000,
      undefined,
      true,
    );
    return fullResp;
  } catch (err) {
    logger.error(
      `Erro ao requisitar cancelamento para IDs ${idsStr}: ${err.message}`,
    );
    throw err;
  }
}
export { requestCancelOrders };

// Admin API: resend FAIL orders (idsArray: array of strings/ints)
async function requestResendOrders(idsArray = []) {
  if (!Array.isArray(idsArray) || idsArray.length === 0) {
    throw new Error('Nenhum ID fornecido para resend');
  }
  const idsStr = idsArray
    .map((i) => String(i).trim())
    .filter(Boolean)
    .join(',');
  const url = `${ADMIN_API_BASE_URL}/orders/resend`;
  const body = { ids: idsStr };
  try {
    const fullResp = await requestWithRetry(
      url,
      'POST',
      body,
      3,
      15000,
      getApiHeaders(),
      true,
    );
    return fullResp;
  } catch (err) {
    logger.error(
      `Erro ao requisitar resend para IDs ${idsStr}: ${err.message}`,
    );
    throw err;
  }
}

// Admin API: cancel & refund FAIL orders (idsArray: array of strings/ints)
async function requestAdminCancelOrders(idsArray = [], cancelReason = '') {
  if (!Array.isArray(idsArray) || idsArray.length === 0) {
    throw new Error('Nenhum ID fornecido para admin cancel');
  }
  const idsStr = idsArray
    .map((i) => String(i).trim())
    .filter(Boolean)
    .join(',');
  const url = `${ADMIN_API_BASE_URL}/orders/cancel`;
  const body = { ids: idsStr };
  if (cancelReason) body.cancel_reason = String(cancelReason);
  try {
    const fullResp = await requestWithRetry(
      url,
      'POST',
      body,
      3,
      15000,
      getApiHeaders(),
      true,
    );
    return fullResp;
  } catch (err) {
    logger.error(
      `Erro ao requisitar admin cancel para IDs ${idsStr}: ${err.message}`,
    );
    throw err;
  }
}

export { requestResendOrders, requestAdminCancelOrders };
