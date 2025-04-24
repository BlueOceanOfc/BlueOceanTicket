const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('./services/axiosInterceptor');
const axios = require('axios');
const { logger, log, setSender } = require('./logger'); // Sistema de logs
const config = require('./config'); // Arquivo de configuração
const sheetsService = require('./services/sheetsService'); // Serviço para registrar no Google Sheets
//const app = require('./app'); // Importa o app.js
const chalk = require('chalk');

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
  gerarMensagemSolicitandoOrderId,
  extrairTodosOrderIds,
  cortarMensagemUtil,
} = require('./services/iaSolicitacao');

function separador() {
  logger.info(
    chalk.blue(
      '\n=====================================================================\n',
    ),
  );
}
console.log(logger);
// Função para registrar os dados no Google Sheets
async function registrarNoGoogleSheets(orderData) {
  try {
    const {
      orderId,
      externalId,
      user,
      link,
      startCount,
      quantity,
      serviceId,
      serviceName,
      status,
      remains,
      createdAt,
      provider,
      mensagemDoCliente,
      lastMessage,
    } = orderData;

    // Dados a serem registrados na planilha
    const dados = [
      orderId,
      externalId,
      user,
      link,
      startCount,
      quantity,
      serviceId,
      serviceName,
      status,
      remains,
      createdAt,
      provider,
      mensagemDoCliente,
      lastMessage, // Adiciona a última mensagem
    ];

    // Chama o serviço para registrar no Google Sheets
    await sheetsService.registrarNoGoogleSheets(dados); // Usando a função existente
  } catch (erro) {
    logger.error(`Erro ao registrar no Google Sheets: ${erro.message}`);
  }
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
      quantity: orderData.quantity || 'Não informado',
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
    logger.info(
      `⚠️ Aviso de solicitação ambígua registrado para o ticket ${ticketId}`,
    );
  } catch (erro) {
    logger.info(
      `❌ Erro ao registrar aviso de solicitação ambígua: ${erro.message}`,
    );
  }
}

// Função para limpar o texto padrão
function limparMensagem(mensagem) {
  // Texto padrão a ser removido (ajuste conforme necessário)
  const textoPadrao =
    'Por favor, nos envie o *ID do pedido* para que possamos continuar com a sua solicitação.';

  // Remove o texto padrão, se estiver presente, e remove espaços extras
  return mensagem.replace(textoPadrao, '').trim();
}

async function processarTicket(ticketId, lastExecution) {
  try {
    // Variável para controle de resposta enviada
    let respostaEnviada = false;

    // Busca o ticket
    const ticket = await buscarTicket(ticketId);
    if (!ticket) {
      logger.info(`❌ Ticket com ID ${ticketId} não encontrado.`);
      return; // Não faz nada se o ticket não existir
    }

    const { messages } = ticket;

    // Verifica se alguma mensagem foi enviada pelo atendente (staff)
    const mensagemDeAtendente = messages.find((msg) => msg.is_staff);
    if (mensagemDeAtendente) {
      logger.info(
        `✅ Ticket ${ticketId} já foi respondido. Ignorando novas mensagens.`,
      );
      return; // Não processa se já houver qualquer resposta do atendente
    }

    // Encontra a primeira mensagem do cliente (não do suporte)
    const primeiraMensagem = messages.find((msg) => !msg.is_staff);

    if (!primeiraMensagem) {
      logger.info(
        `❌ Nenhuma mensagem do cliente encontrada no ticket ${ticketId}.`,
      );
      return; // Não faz nada se não houver mensagens do cliente
    }

    // Limpar a mensagem antes de processar
    const mensagemLimpa = limparMensagem(primeiraMensagem.message);

    // Log da mensagem limpa (o que o processador realmente leu)
    logger.info(`mensagem lida: ${cortarMensagemUtil(mensagemLimpa)}`);

    // Verifica se a mensagem limpa ainda tem conteúdo
    if (!mensagemLimpa) {
      logger.info(
        `❌ A mensagem do ticket ${ticketId} foi removida após a limpeza.`,
      );
      return;
    }

    const lastUpdateTime = new Date(ticket.last_update_timestamp * 1000);
    const lastExecTime = new Date(lastExecution);

    // Verifica se o ticket foi atualizado após a última execução
    if (lastUpdateTime <= lastExecTime) {
      logger.info(
        `Ticket ID ${ticketId} não tem novas atualizações após a última execução.`,
      );
      return; // Não processa se não houver atualizações novas
    }

    // Detectar o idioma da primeira mensagem do cliente
    const idiomaDetectado = await detectLanguage([primeiraMensagem]);

    // Extraindo os Order IDs diretamente usando a função `extrairTodosOrderIds`
    const orderIdsExtraidos = extrairTodosOrderIds(mensagemLimpa);
    logger.info(
      `🔑 [processarTicket] Order IDs extraídos: ${orderIdsExtraidos.join(
        ', ',
      )}`,
    );

    // Verificar tipo de solicitação
    const { tipoSolicitacao, orderIds = [] } = await verificarTipoDeSolicitacao(
      messages,
    );

    // Se o tipo de solicitação for Pago ou Outro, ignora a solicitação
    if (['Pagamento', 'Outro'].includes(tipoSolicitacao)) {
      logger.info(
        `🚫 [processarTicket] Ticket ID ${ticketId} ignorado por ser do tipo: ${tipoSolicitacao}`,
      );

      // Registra no Google Sheets
      await registrarNoGoogleSheets({
        orderId: 'Não informado',
        mensagemDoCliente: primeiraMensagem.message,
        lastMessage: `Ticket ignorado automaticamente. Tipo detectado: ${tipoSolicitacao}`,
      });

      return; // Não continua o processamento dos pedidos
    }

    // Verifica se os Order IDs foram encontrados
    if (orderIdsExtraidos.length === 0) {
      logger.info(
        `❓ [processarTicket] Ticket ID ${ticketId} não contém Order ID. Solicitando ao cliente...`,
      );

      // Solicita o Order ID, mas só envia se ainda não tiver sido enviado
      if (!respostaEnviada) {
        const mensagemSolicitacao = await gerarMensagemSolicitandoOrderId(
          idiomaDetectado,
        );
        logger.info(
          `❓ [processarTicket] Solicitando Order ID ao cliente no Ticket ID ${ticketId}.`,
        );
        await responderTicket(ticketId, mensagemSolicitacao);

        // Marca que a resposta foi enviada
        respostaEnviada = true;

        // Registra a solicitação no Google Sheets
        await registrarNoGoogleSheets({
          orderId: 'Não informado',
          mensagemDoCliente: primeiraMensagem.message,
          lastMessage: mensagemSolicitacao,
        });
      }

      return; // Não continua o processamento dos pedidos
    }

    // Processa os pedidos com base nos Order IDs extraídos
    let pedidosAptos = [];
    let pedidosNaoAptos = [];
    let orderDataList = [];

    for (const orderId of orderIdsExtraidos) {
      try {
        let orderData = await buscarStatusPedido(orderId);
        if (!orderData) {
          logger.info(`❌ Pedido ID ${orderId} não encontrado.`);
          pedidosNaoAptos.push({ orderId, motivo: 'Não encontrado' });
          continue;
        }

        if (orderData.status === 'canceled') {
          pedidosNaoAptos.push({ orderId, motivo: 'Pedido cancelado' });
        } else if (orderData.status === 'completed') {
          pedidosNaoAptos.push({ orderId, motivo: 'Pedido já completo' });
        } else {
          pedidosAptos.push(orderId);
        }
        orderDataList.push(orderData);
      } catch (error) {
        logger.info(
          `❌ Erro ao buscar o pedido ID ${orderId}: ${error.message}`,
        );
      }
    }

    // Garante que estamos pegando a primeira mensagem real do cliente
    const mensagensDoCliente = messages.filter(
      (mensagem) => mensagem.sender === 'client' || !mensagem.is_staff,
    );

    logger.info(
      `📥 Mensagens do cliente encontradas:`,
      mensagensDoCliente.map((m) => m.message),
    );

    // Função local para remover tags HTML e números no início
    function tirarNumero(mensagem) {
      if (!mensagem) return '';

      // Remove tags HTML e outros ajustes
      mensagem = mensagem.replace(/<[^>]*>/g, ' ');
      mensagem = mensagem.replace(/(\d+)([a-zA-Z]+)/g, '$1 $2'); // número + letras
      mensagem = mensagem.replace(/([a-zA-Z]+)(\d+)/g, '$1 $2'); // letras + número
      mensagem = mensagem.replace(/[^a-zA-ZÀ-ÿ\s]/g, ''); // Remove caracteres especiais
      mensagem = mensagem.replace(/\s+/g, ' ').trim(); // Remove espaços extras
      return mensagem.toLowerCase();
    }

    // Pega a primeira mensagem e processa
    const primeiraMensagemBruta =
      mensagensDoCliente?.[0]?.message || 'Mensagem não encontrada';
    const mensagemCortada = cortarMensagemUtil(primeiraMensagemBruta);
    const primeiraMensagemDoCliente = tirarNumero(mensagemCortada);

    logger.info(
      `✅ Primeira mensagem do cliente usada para registro: ${primeiraMensagemDoCliente}`,
    );

    // Gerar a resposta final com os pedidos
    const respostaFinal = await gerarRespostaFinal(
      ticketId,
      tipoSolicitacao,
      orderIdsExtraidos,
      orderDataList,
      idiomaDetectado,
    );

    logger.info(`✉️ [processarTicket] Resposta gerada: ${respostaFinal}`);

    // Envia a resposta ao cliente, mas apenas se ainda não tiver sido enviada
    if (respostaFinal && !respostaEnviada) {
      logger.info(
        `📝 [processarTicket] Enviando resposta para o ticket ${ticketId}`,
      );
      await responderTicket(ticketId, respostaFinal);

      // Marca que a resposta foi enviada
      respostaEnviada = true;
    }

    // Registrar os dados para todos os Order IDs extraídos
    for (const orderId of orderIdsExtraidos) {
      try {
        let orderData = await buscarStatusPedido(orderId);
        if (!orderData) {
          logger.info(`❌ Pedido ID ${orderId} não encontrado.`);
          continue;
        }

        await registrarNoGoogleSheets({
          orderId: orderId,
          externalId: orderData.externalId,
          user: orderData.user,
          link: orderData.link,
          startCount: orderData.startCount,
          quantity: orderData.quantity,
          serviceId: orderData.serviceId,
          serviceName: orderData.serviceName,
          status: orderData.status,
          remains: orderData.remains,
          createdAt: orderData.createdAt,
          provider: orderData.provider,
          mensagemDoCliente: primeiraMensagemDoCliente,
          lastMessage: respostaFinal,
        });

        logger.info(
          `📊 Registro no Google Sheets: ✅ Sucesso para o Pedido ID ${orderId}`,
        );
      } catch (error) {
        logger.info(`📊 Registro no Google Sheets: ❌ Erro - ${error.message}`);
      }
    }

    logger.info('------------------------------------------------------------');
  } catch (error) {
    logger.info(`❌ Erro ao processar o ticket ${ticketId}: ${error.message}`);
  }
}

let isProcessing = false; // Variável de controle para evitar execução duplicada
let automationInterval; // Declare o intervalo globalmente

// Função para iniciar a automação
function iniciarAutomacao() {
  logger.info(chalk.blue.bold('✅ Iniciando a automação...'));

  // Definindo o intervalo de 20 segundos (20000 milissegundos)
  automationInterval = setInterval(async () => {
    if (isProcessing) return; // Evita novas execuções enquanto uma já está em andamento
    isProcessing = true; // Marca que está processando

    logger.info('🔍 Iniciando consulta a cada 30 segundos...');

    try {
      await processarTodosTickets(); // Executa o processo
    } catch (erro) {
      logger.error(`Erro ao processar os tickets: ${erro.message}`);
    } finally {
      isProcessing = false; // Sempre reseta após a execução
    }
  }, 30000); // Intervalo de 30 segundos
}

function pararAutomacao() {
  logger.info(chalk.blue.bold('🛑 Parando a automação...'));

  // Adiciona um delay para a parada ser visualmente mais interessante
  setTimeout(() => {
    logger.info(chalk.yellow.bold('⚠️ Automação parada.'));
    clearInterval(automationInterval); // Limpa o intervalo da automação
  }, 1000); // Atraso de 1 segundo para dar um efeito de transição
}

// Função para processar todos os tickets
async function processarTodosTickets() {
  try {
    const tickets = await listarTickets();

    if (tickets.length === 0) {
      logger.info('📭 Nenhum ticket encontrado.');
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

    // Logs visuais direto com logger.info
    logger.info(
      `📅 Última atualização registrada: ${ultimaAtualizacaoFormatada}`,
    );
    logger.info(`📨 Total de tickets encontrados: ${tickets.length}`);

    const lastExecution = obterUltimaExecucao();
    const ticketsParaProcessar = tickets.filter((ticket) => {
      const lastUpdateTime = new Date(ticket.last_update_timestamp * 1000);
      return lastUpdateTime > new Date(lastExecution);
    });

    if (ticketsParaProcessar.length === 0) {
      logger.info(
        '🟡 Nenhum novo ticket ou mensagem desde a última verificação.',
      );
      separador();
      return;
    }

    logger.info(
      `✅ Novas mensagens detectadas: ${ticketsParaProcessar.length} ticket(s) com atualização.`,
    );

    // Processa os tickets um por vez para evitar múltiplas mensagens enviadas
    for (const ticket of ticketsParaProcessar) {
      try {
        // Aguarda o processamento de um ticket antes de iniciar o próximo
        await processarTicket(ticket.id, lastExecution);
      } catch (erro) {
        logger.error(`Erro ao processar ticket ${ticket.id}: ${erro.message}`);
      }
    }

    atualizarUltimaExecucao();
    separador();
  } catch (erro) {
    logger.error(`Erro ao processar os tickets: ${erro.message}`);
  }
}

// Função de watchdog para verificar se o processo está travado por muito tempo
let lastExecutionTime = Date.now(); // Inicia com o timestamp atual

setInterval(() => {
  try {
    if (isProcessing && Date.now() - lastExecutionTime > 10000) {
      // 10 segundos travado
      logger.error('⚠️ Automação travada. Reiniciando o processo...');
      isProcessing = false; // Reseta o processamento travado
      iniciarAutomacao(); // Reinicia a automação
    }
  } catch (erro) {
    logger.error(`Erro no intervalo de execução: ${erro.message}`);
  }
}, 20000); // Verifica a cada 20 segundos

// Função para reiniciar a automação em caso de falha crítica
async function retryExecution() {
  let retries = 3; // Tentar 3 vezes
  while (retries > 0) {
    try {
      await processarTodosTickets(); // Tentativa de processar novamente
      break; // Se funcionar, sai do loop
    } catch (erro) {
      logger.error(`Erro ao tentar processar: ${erro.message}`);
      retries -= 1;
      if (retries === 0) {
        logger.error('🚨 Tentativas esgotadas. Automação reiniciada.');
        iniciarAutomacao(); // Reinicia a automação se as tentativas falharem
      } else {
        logger.info(`🔄 Tentando novamente... Restam ${retries} tentativa(s).`);
      }
    }
  }
}

module.exports = {
  iniciarAutomacao,
  pararAutomacao,
  processarTodosTickets,
  processarTicket,
};
