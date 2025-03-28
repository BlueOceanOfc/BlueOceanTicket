/*
const axios = require('axios');
require('dotenv').config(); // Carregar variáveis de ambiente
const logger = require('../logger'); // Sistema de logs
const sheetsService = require('../services/sheetsService'); // Serviço para registrar no Google Sheets
const config = require('../config'); // Arquivo de configuração

// Função para buscar os dados do pedido e retornar as informações relevantes
async function buscarStatusPedido(orderId) {
  try {
    // URL da API de pedidos
    const orderApiUrl = `${process.env.ORDER_API_BASE_URL}/orders/${orderId}`;

    //logger.info(`Buscando status do pedido na URL: ${orderApiUrl}`);

    // Fazendo a requisição para obter os dados do pedido
    const resposta = await axios.get(orderApiUrl, {
      headers: { 'X-Api-Key': process.env.API_KEY }, // Chave de API para autenticação
    });

    const dadosPedido = resposta.data.data;

    // Retorna todos os dados do pedido
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
    return null; // Retorna null caso haja erro
  }
}

// Função para buscar um ticket específico usando seu ID
async function buscarTicket(ticketId) {
  try {
    const resposta = await axios.get(
      `${config.ticketAPIBaseURL}/tickets/${ticketId}`,
      {
        headers: { 'X-Api-Key': config.API_KEY }, // Autenticação com a chave da API
      },
    );

    return resposta.data.data; // Retorna os detalhes do ticket
  } catch (erro) {
    logger.error(`Erro ao buscar ticket com ID ${ticketId}: ${erro.message}`);
    return null; // Retorna null em caso de erro
  }
}

// Função para registrar os dados no Google Sheets
async function registrarNoGoogleSheets(orderData) {
  try {
    const {
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
    } = orderData;

    // Dados a serem registrados na planilha
    const dados = [
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
    ];

    // Chama o serviço para registrar no Google Sheets
    await sheetsService.registrarNoGoogleSheets(dados); // Usando a função existente
    //logger.info(`Dados registrados no Google Sheets para o pedido ${orderId}`);
  } catch (erro) {
    logger.error(`Erro ao registrar dados no Google Sheets: ${erro.message}`);
  }
}

async function processarTicket(ticketId) {
  const ticket = await buscarTicket(ticketId); // Busca o ticket pelo ID

  if (!ticket) {
    return logger.error(`Ticket com ID ${ticketId} não encontrado.`);
  }

  const { subject, status, messages } = ticket;
  let orderId = null;

  // logger.info(`Processando ticket ID ${ticketId}: ${subject}`);

  // Tentando extrair o orderId se não estiver diretamente no ticket
  if (Array.isArray(messages) && messages.length > 0) {
    messages.forEach((message) => {
      if (message && message.message) {
        // logger.info(`Mensagem do ticket: ${message.message}`);

        // Tentando extrair o OrderID da mensagem do ticket
        const regex = /ID Do Pedido.*?(\d+)/;
        const match = message.message.match(regex);
        if (match && match[1]) {
          orderId = match[1]; // Extraindo o orderId da mensagem
          // logger.info(`OrderID extraído da mensagem: ${orderId}`);
        }
      } else {
        logger.warn(`Mensagem inválida no ticket ${ticketId}.`);
      }
    });
  } else {
    logger.warn(
      `Ticket ${ticketId} não tem mensagens ou o campo 'messages' está vazio.`,
    );
  }

  // Se não encontrar o orderId diretamente, retorna erro
  if (!orderId) {
    logger.error(`OrderID não encontrado no ticket ${ticketId}.`);
    return;
  }

  // Agora, buscamos os dados do pedido na API de orders usando o orderId extraído
  const orderData = await buscarStatusPedido(orderId);

  if (orderData) {
    //logger.info(`Status do pedido ${orderId}: ${orderData.status}`);

    // Registrando os dados no Google Sheets
    await registrarNoGoogleSheets(orderData); // Registra os dados do pedido na planilha
  } else {
    logger.error(`Não foi possível obter os dados do pedido ${orderId}.`);
  }
}

// Exemplo de uso
const ticketId = 3; // Substitua pelo ID de um ticket real
//processarTicket();
*/
