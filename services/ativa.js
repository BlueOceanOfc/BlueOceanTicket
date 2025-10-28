import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

// Simula __dirname em ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});

// Validação das variáveis obrigatórias
function validarVariaveisObrigatorias(variaveis) {
  for (const variavel of variaveis) {
    if (!process.env[variavel]) {
      throw new Error(`❌ Variável de ambiente ausente: ${variavel}`);
    }
  }
}
validarVariaveisObrigatorias(['API_KEY', 'TICKET_API_BASE_URL']);

// Logger fallback
let logger;
try {
  logger = (await import('../logger.js')).default;
} catch (e) {
  logger = {
    info: console.log,
    error: console.error,
  };
}

// Centralização de variáveis e headers
const API_KEY = process.env.API_KEY;
const BASE_URL =
  process.env.TICKET_API_BASE_URL || 'https://smmexcellent.com/adminapi/v2';

function getApiHeaders() {
  return { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };
}

// Função utilitária para requisições com retry
async function requestWithRetry(
  url,
  method = 'GET',
  data = null,
  retries = 3,
  timeout = 10000,
  headers = getApiHeaders(),
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
        validateStatus: () => true,
      });
      logger.info(`🔎 Status da resposta: ${response.status}`);
      logger.info(`🔎 Dados brutos: ${JSON.stringify(response.data, null, 2)}`);
      if (response.status === 401) {
        logger.error(
          '❌ Erro 401: Não autorizado. Verifique a API_KEY e permissões.',
        );
      }
      return response.data;
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
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw error;
}

// Busca usuários com filtros e logs detalhados
async function buscarUsuarios(limit = 100, offset = 0) {
  logger.info('🔎 Iniciando busca de usuários...');
  logger.info('🔎 Headers:', getApiHeaders());
  logger.info('🔎 Params:', { limit, offset, sort: 'created-at-asc' });

  const url = `${BASE_URL}/users`;
  const response = await requestWithRetry(
    url,
    'GET',
    null,
    3,
    10000,
    getApiHeaders(),
  );

  if (!response?.data || !Array.isArray(response.data)) {
    logger.error('❌ Nenhum usuário retornado ou resposta inesperada.');
    return [];
  }
  return response.data;
}

// Loga os usuários mais inativos
async function logarUsuariosInativos(qtd = 20) {
  logger.info('🔎 Executando logarUsuariosInativos...');
  const usuarios = await buscarUsuarios(1000, 0);
  logger.info('🔎 Quantidade de usuários retornados:', usuarios.length);

  if (!usuarios.length) {
    logger.info('Nenhum usuário encontrado.');
    return;
  }

  const ordenados = usuarios
    .filter((u) => u.last_auth_timestamp)
    .sort((a, b) => a.last_auth_timestamp - b.last_auth_timestamp)
    .slice(0, qtd);

  logger.info(`Usuários mais inativos (último acesso mais distante):`);
  ordenados.forEach((user, idx) => {
    logger.info(
      `#${idx + 1} | ID: ${user.id} | Username: ${user.username} | Email: ${
        user.email
      } | Último acesso: ${user.last_auth} | Status: ${user.status}`,
    );
    logger.info(`Dados completos: ${JSON.stringify(user, null, 2)}`);
  });
}

// Executa o relatório
logarUsuariosInativos(20);
