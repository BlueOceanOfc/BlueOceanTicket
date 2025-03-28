require('./services/axiosInterceptor');
const axios = require('axios');
const logger = require('./logger'); // Sistema de logs
const config = require('./config'); // Arquivo de configuração
const sheetsService = require('./services/sheetsService'); // Serviço para registrar no Google Sheets
const app = require('./app'); // Importa o app.js
const chalk = require('chalk');
const { gerarRespostaIA } = require('./services/openAIService'); // Função para gerar resposta da IA
const { responderTicket } = require('./services/apiService'); // ou o caminho correto do arquivo onde essa função está definida
const { format } = require('date-fns'); // Adiciona no topo do seu index.js, se ainda não tiver
const { ptBR } = require('date-fns/locale');
const {
  buscarTicket,
  extrairOrderIdDaMensagem,
  buscarStatusPedido,
  listarTickets,
  atualizarUltimaExecucao,
  obterUltimaExecucao,
  salvarMensagensNoArquivo,
  removerTagsHTML,
  garantirDiretorio,
} = require('./services/apiService');
const {
  gerarRespostaFinal,
  verificarTipoDeSolicitacao,
  detectLanguage,
} = require('./iaSolicitacao');

function separador() {
  console.log(
    chalk.blue(
      '\n=====================================================================\n',
    ),
  );
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
      lastMessage,
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
      lastMessage, // Adiciona a última mensagem
    ];

    // Chama o serviço para registrar no Google Sheets
    await sheetsService.registrarNoGoogleSheets(dados); // Usando a função existente
  } catch (erro) {}
}

// Função para registrar aviso de solicitação ambígua
async function registrarAvisoAmbiguo(ticketId, messages) {
  try {
    // Extraímos o Order ID da mensagem
    const orderId = extrairOrderIdDaMensagem(messages);
    if (!orderId) {
      logger.error(
        `Não foi possível extrair o Order ID para o ticket ${ticketId}.`,
      );
      return; // Se não conseguir extrair o Order ID, não faz nada
    }

    // Busca as informações do pedido, mesmo em caso de ambiguidade
    let orderData = await buscarStatusPedido(orderId);

    if (!orderData) {
      logger.error(`Não foi possível obter os dados do pedido ${orderId}`);
      return;
    }

    // Dados para registrar no Google Sheets
    const aviso = {
      orderId: orderData.orderId || 'Não informado',
      externalId: orderData.externalId || 'Não informado',
      user: orderData.user || 'Não informado',
      link: orderData.link || 'Não informado',
      startCount: orderData.startCount || 'Não informado',
      amount: orderData.amount || 'Não informado',
      serviceId: orderData.serviceId || 'Não informado',
      serviceName: orderData.serviceName || 'Não informado',
      status: orderData.status || 'Não informado',
      remains: orderData.remains || 'Não informado',
      createdAt: orderData.createdAt || new Date().toISOString(),
      provider: orderData.provider || 'Não informado',
      lastMessage: 'Solicitação ambígua ou dois assuntos identificados', // Mensagem de ambiguidade
    };

    // Registra o aviso no Google Sheets
    await sheetsService.registrarNoGoogleSheets(aviso);
    console.log(
      `⚠️ Aviso de solicitação ambígua registrado para o ticket ${ticketId}`,
    );
  } catch (erro) {
    console.log(
      `❌ Erro ao registrar aviso de solicitação ambígua: ${erro.message}`,
    );
  }
}

// Função principal para processar um ticket
async function processarTicket(ticketId, lastExecution) {
  const ticket = await buscarTicket(ticketId); // Busca o ticket

  if (!ticket) {
    console.log(`❌ Ticket com ID ${ticketId} não encontrado.`);
    return; // Não faz nada se o ticket não existir
  }

  const { messages } = ticket;
  const lastMessage = messages[messages.length - 1]; // A última mensagem do cliente
  const lastUpdateTime = new Date(ticket.last_update_timestamp * 1000);
  const lastExecTime = new Date(lastExecution);

  // Verifica se o ticket foi atualizado após a última execução
  if (lastUpdateTime <= lastExecTime) {
    logger.info(
      `Ticket ID ${ticketId} não tem novas atualizações após a última execução.`,
    );
    return; // Não processa se não houver atualizações novas
  }

  // Verifica se a última mensagem foi do cliente (não do suporte)
  if (lastMessage.is_staff) {
    logger.info(
      `Ticket ID ${ticketId} não tem novas mensagens do cliente. A última mensagem foi do suporte.`,
    );
    return; // Não processa se a última mensagem não for do cliente
  }

  // Detectar o idioma da última mensagem do cliente
  const idiomaDetectado = await detectLanguage([lastMessage]); // Detecta o idioma

  // Identificando o tipo de solicitação e o Order ID
  const { tipoSolicitacao, orderId } = await verificarTipoDeSolicitacao(
    messages,
  );
  const emojiTipo = {
    Cancelamento: '🗑️',
    Aceleração: '🚀',
    'Refil/Garantia': '🔁',
    Outro: '🌀',
  };

  // Se a IA identificou dois tipos de solicitação, trata a ambiguidade
  if (
    tipoSolicitacao.includes('Cancelamento') &&
    tipoSolicitacao.includes('Aceleração')
  ) {
    logger.info(
      `Ticket ID ${ticketId} tem dois assuntos identificados. Registrando como ambíguo.`,
    );
    // Registra o aviso de ambiguidade no Google Sheets
    return; // Não responderemos ao ticket, pois há ambiguidade
  }

  // Caso não tenha Order ID, pede ao cliente para enviar
  if (!orderId) {
    logger.info(
      `Pedido sem Order ID para o ticket ${ticketId}. Pedindo ao cliente.`,
    );
    await registrarNoGoogleSheets({
      orderId: 'Não informado',
      lastMessage: 'Solicitação sem Order ID, pedindo ao cliente.',
    });
    return;
  }

  let orderData = await buscarStatusPedido(orderId);

  if (!orderData) {
    logger.error(`Não foi possível obter os dados do pedido ${orderId}`);
    return;
  }

  // Gerar a resposta final
  const respostaFinal = await gerarRespostaFinal(
    ticketId,
    tipoSolicitacao,
    orderId,
    orderData,
    idiomaDetectado, // Usando o idioma detectado aqui
  );

  // ✨ LOG FINAL
  console.log(`\n🎫 Ticket ID: ${ticketId}`);
  console.log(
    `${
      emojiTipo[tipoSolicitacao] || '📋'
    } Tipo de solicitação para o ticket ${ticketId}: ${tipoSolicitacao}`,
  );
  console.log(`📈 Status do pedido: ${orderData.status}`);
  console.log(`✉️ Resposta enviada ao cliente:\n  ${respostaFinal}\n`);

  if (respostaFinal) {
    await responderTicket(ticketId, respostaFinal); // Envia a resposta ao cliente
    //logger.info(`Resposta enviada para o ticket ${ticketId}.`);
  }

  // Registra os dados completos do pedido no Google Sheets
  try {
    await registrarNoGoogleSheets({
      orderId,
      externalId: orderData.externalId,
      user: orderData.user,
      link: orderData.link,
      startCount: orderData.startCount,
      amount: orderData.amount,
      serviceId: orderData.serviceId,
      serviceName: orderData.serviceName,
      status: orderData.status,
      remains: orderData.remains,
      createdAt: orderData.createdAt,
      provider: orderData.provider,
      lastMessage: respostaFinal,
    });
    console.log(`📊 Registro no Google Sheets: ✅ Sucesso`);
  } catch (error) {
    console.log(`📊 Registro no Google Sheets: ❌ Erro - ${error.message}`);
  }

  console.log('------------------------------------------------------------');
}

let isProcessing = false; // Variável de controle para evitar execução duplicada

// Função para fazer consultas a cada 5 segundos
function iniciarConsultaPeriodica() {
  // Definindo o intervalo de 5 segundos (5000 milissegundos)
  setInterval(async () => {
    if (isProcessing) return; // Evita novas execuções enquanto uma já está em andamento
    isProcessing = true;

    console.log('🔍 Iniciando consulta a cada 5 segundos...');
    console.log('');

    await processarTodosTickets(); // Chama a função que processa os tickets

    // Após o processamento, reinicia o controle de execução
    isProcessing = false;
  }, 5000); // 5000 milissegundos = 5 segundos
}

// Função para processar todos os tickets (respondidos ou novos) após a última execução
async function processarTodosTickets() {
  const tickets = await listarTickets();

  if (tickets.length === 0) {
    console.log('📭 Nenhum ticket encontrado.'); // Só mostra o log se não houver tickets
    separador();
    return;
  }

  const ultimaAtualizacao = new Date(
    Math.max(...tickets.map((t) => t.last_update_timestamp * 1000)),
  );
  const ultimaAtualizacaoFormatada = format(
    ultimaAtualizacao,
    "EEEE, dd 'de' MMMM 'de' yyyy'\n⏰ Horário:' HH:mm:ss",
    { locale: ptBR },
  );

  // Logs visuais direto com console.log
  console.log(
    `📅 Última atualização registrada: ${ultimaAtualizacaoFormatada}`,
  );
  console.log(`📨 Total de tickets encontrados: ${tickets.length}`);

  const lastExecution = obterUltimaExecucao();
  const ticketsParaProcessar = tickets.filter((ticket) => {
    const lastUpdateTime = new Date(ticket.last_update_timestamp * 1000);
    return lastUpdateTime > new Date(lastExecution);
  });

  if (ticketsParaProcessar.length === 0) {
    console.log(
      '🟡 Nenhum novo ticket ou mensagem desde a última verificação.',
    );
    separador();
    return;
  }

  console.log(
    `✅ Novas mensagens detectadas: ${ticketsParaProcessar.length} ticket(s) com atualização.`,
  );

  // Processa os tickets em paralelo
  const processamentos = ticketsParaProcessar.map((ticket) =>
    processarTicket(ticket.id, lastExecution),
  );
  await Promise.all(processamentos);

  atualizarUltimaExecucao();

  separador();
}

// Inicia a consulta periódica
iniciarConsultaPeriodica();
