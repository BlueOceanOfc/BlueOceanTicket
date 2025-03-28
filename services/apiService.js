const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../logger'); // Sistema de logs
const sheetsService = require('./sheetsService'); // Serviço de integração com o Google Sheets
const orderService = require('./orderService'); // Serviço de pedidos
const config = require('../config'); // Arquivo de configuração
require('dotenv').config(); // Carrega variáveis de ambiente

// Arquivo onde a última execução será salva
const LAST_EXECUTION_FILE = path.join(__dirname, 'last_execution.json');

// Arquivo onde as mensagens do ticket serão salvas
const MESSAGES_LOG_PATH = path.join(__dirname, 'messages_logs');
const MESSAGES_LOG_FILE = path.join(
  MESSAGES_LOG_PATH,
  'ticket_messages_log.txt',
);

// Função para realizar requisições HTTP com tentativas e timeout
async function requestWithRetry(
  url,
  method = 'GET',
  data = null,
  retries = 3,
  timeout = 10000,
) {
  let error = null;
  while (retries > 0) {
    try {
      const response = await axios({
        method,
        url,
        data,
        headers: { 'X-Api-Key': config.API_KEY },
        timeout,
      });
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
      await new Promise((resolve) => setTimeout(resolve, 3000)); // Espera de 3 segundos
    }
  }
  throw error; // Caso todas as tentativas falhem
}

// Função para buscar um ticket específico usando seu ID
async function buscarTicket(ticketId) {
  try {
    const data = await requestWithRetry(
      `${config.ticketAPIBaseURL}/tickets/${ticketId}`,
    );
    return data.data; // Retorna os dados do ticket
  } catch (error) {
    logger.error(`Erro ao buscar ticket com ID ${ticketId}: ${error.message}`);
    return null;
  }
}

// Função para verificar se o pedido já foi cancelado
async function verificarCancelamento(orderId) {
  try {
    const data = await requestWithRetry(
      `${config.ticketAPIBaseURL}/orders/${orderId}`,
    );
    return data.data.status === 'canceled'; // Retorna verdadeiro se o pedido foi cancelado
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

    const resposta = await axios.post(
      `${config.ticketAPIBaseURL}/tickets/${ticketId}/reply`,
      { staff_name: staffName, message: mensagem },
      {
        headers: {
          'X-Api-Key': config.API_KEY,
          'Content-Type': 'application/json',
        },
      },
    );
    return resposta.data;
  } catch (erro) {
    logger.error(`Erro ao responder ao ticket ${ticketId}: ${erro.message}`);
    return null;
  }
}

// Função para registrar os dados no Google Sheets
async function registrarNoGoogleSheets(
  orderId,
  externalId,
  user,
  link,
  startCount,
  amount,
  serviceId,
  serviceName,
  status,
  remains,
  createdAt,
  provider,
) {
  try {
    const doc = await sheetsService.conectarSheets(); // Conecta à planilha
    const sheet = doc.sheetsByIndex[0]; // Pega a primeira aba da planilha

    const novaLinha = {
      OrderID: orderId,
      ExternalId: externalId,
      User: user,
      Link: link,
      StartCount: startCount,
      Amount: amount,
      ServiceId: serviceId,
      ServiceName: serviceName,
      Status: status,
      Remains: remains,
      CreatedAt: createdAt,
      Provider: provider,
      DataHora: new Date().toLocaleString(),
    };

    await sheet.addRow(novaLinha); // Adiciona a linha com os dados
  } catch (erro) {
    logger.error(`Erro ao registrar dados no Google Sheets: ${erro.message}`);
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
      const match = msg.message.match(/\b\d{5,}\b/); // Procura por números com 5 ou mais dígitos
      if (match) return match[0]; // Retorna o primeiro ID encontrado
    }
  }
  return null;
}

// Função para buscar os dados do pedido
async function buscarStatusPedido(orderId) {
  try {
    const orderApiUrl = `${process.env.ORDER_API_BASE_URL}/orders/${orderId}`;
    const resposta = await axios.get(orderApiUrl, {
      headers: { 'X-Api-Key': process.env.API_KEY },
    });
    const dadosPedido = resposta.data.data;

    return {
      orderId: dadosPedido.id,
      externalId: dadosPedido.external_id,
      user: dadosPedido.user,
      link: dadosPedido.link,
      startCount: dadosPedido.start_count,
      amount: dadosPedido.charge.formatted,
      serviceId: dadosPedido.service_id,
      serviceName: dadosPedido.service_name,
      status: dadosPedido.status,
      remains: dadosPedido.remains,
      createdAt: dadosPedido.created,
      provider: dadosPedido.provider,
    };
  } catch (erro) {
    logger.error(`Erro ao buscar status do pedido ${orderId}: ${erro.message}`);
    return null;
  }
}

// Função principal para processar tickets e realizar verificações
async function processarTicket(ticketId) {
  const ticket = await buscarTicket(ticketId);
  if (!ticket) return logger.error(`Ticket com ID ${ticketId} não encontrado.`);

  const { subject, status, messages } = ticket;
  let finalOrderId = extrairOrderIdDaMensagem(messages);

  if (!finalOrderId)
    return logger.error(`Order ID não encontrado para o ticket ${ticketId}.`);

  let historicoInteracoes = [{ pergunta: ticket.descricao, resposta: '' }];
  let respostaIA = await gerarRespostaIA(historicoInteracoes);

  if (!respostaIA) {
    logger.error('Erro: A resposta da IA não foi gerada corretamente.');
    return;
  }

  const respostaEnviada = await responderTicket(ticketId, respostaIA);

  if (!respostaEnviada) {
    logger.error(`Erro ao responder ao ticket ${ticketId}.`);
    return;
  }

  if (respostaIA.toLowerCase().includes('resolvido')) {
    logger.info(
      `Resposta IA enviada com sucesso para o ticket ${ticketId}: ${respostaIA}`,
    );
    await registrarNoGoogleSheets(finalOrderId, 'Resolvido', respostaIA);
  } else {
    const respostaFinal =
      'Este problema não foi resolvido após 3 tentativas de nossa IA. Por favor, assuma o atendimento diretamente.';
    await responderTicket(ticketId, respostaFinal);
    await registrarNoGoogleSheets(finalOrderId, 'Não resolvido', respostaFinal);
  }

  const orderData = await orderService.buscarDadosPedido(finalOrderId);

  if (orderData) {
    await registrarNoGoogleSheets(
      orderData.orderId,
      orderData.externalId,
      orderData.user,
      orderData.link,
      orderData.startCount,
      orderData.amount,
      orderData.serviceId,
      orderData.serviceName,
      orderData.status,
      orderData.remains,
      orderData.createdAt,
      orderData.provider,
    );
  } else {
    logger.warn(
      `Pedido com ID ${finalOrderId} não encontrado na API de pedidos.`,
    );
  }
}

// Função para listar tickets
async function listarTickets(limite = 100) {
  try {
    const resposta = await axios.get(`${config.ticketAPIBaseURL}/tickets`, {
      headers: { 'X-Api-Key': config.API_KEY },
      params: {
        limit: limite,
        sort_by: 'created_at',
        order: 'desc',
      },
    });

    return resposta.data.data?.list || [];
  } catch (erro) {
    logger.error(`Erro ao listar tickets: ${erro.message}`);
    return [];
  }
}

// Função para obter a hora da última execução
function obterUltimaExecucao() {
  try {
    const dados = fs.readFileSync(LAST_EXECUTION_FILE, 'utf8');
    return JSON.parse(dados).lastExecution;
  } catch (erro) {
    return null; // Retorna null se não existir
  }
}

// Função para atualizar a hora da última execução
function atualizarUltimaExecucao() {
  const dataHoraAtual = new Date().toISOString();
  const dados = { lastExecution: dataHoraAtual };
  fs.writeFileSync(LAST_EXECUTION_FILE, JSON.stringify(dados), 'utf8');
  return dataHoraAtual;
}

// Função para salvar as mensagens no arquivo
async function salvarMensagensNoArquivo(
  ticketId,
  lastMessage,
  orderId,
  allMessages,
) {
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

  const formattedMessages = allMessages
    .split('\n')
    .map((msg) => removerTagsHTML(msg.trim()))
    .join('\n');

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

module.exports = {
  garantirDiretorio,
  buscarTicket,
  responderTicket,
  processarTicket,
  registrarNoGoogleSheets,
  extrairOrderIdDaMensagem,
  buscarStatusPedido,
  listarTickets,
  obterUltimaExecucao,
  atualizarUltimaExecucao,
  salvarMensagensNoArquivo,
  removerTagsHTML,
};
