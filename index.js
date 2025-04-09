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
  gerarMensagemSolicitandoOrderId,
  extrairTodosOrderIds,
  cortarMensagemUtil,
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
      quantity,
      serviceId,
      serviceName,
      status,
      remains,
      createdAt,
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
      mensagemDoCliente,
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
    console.log(
      `⚠️ Aviso de solicitação ambígua registrado para o ticket ${ticketId}`,
    );
  } catch (erro) {
    console.log(
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

// Função principal para processar um ticket
async function processarTicket(ticketId, lastExecution) {
  try {
    // Busca o ticket
    const ticket = await buscarTicket(ticketId);
    if (!ticket) {
      console.log(`❌ Ticket com ID ${ticketId} não encontrado.`);
      return; // Não faz nada se o ticket não existir
    }

    const { messages } = ticket;

    // Verifica se alguma mensagem foi enviada pelo atendente (staff)
    const mensagemDeAtendente = messages.find((msg) => msg.is_staff);
    if (mensagemDeAtendente) {
      console.log(
        `✅ Ticket ${ticketId} já foi respondido. Ignorando novas mensagens.`,
      );
      return; // Não processa se já houver qualquer resposta do atendente
    }

    // Encontra a primeira mensagem do cliente (não do suporte)
    const primeiraMensagem = messages.find((msg) => !msg.is_staff);

    if (!primeiraMensagem) {
      console.log(
        `❌ Nenhuma mensagem do cliente encontrada no ticket ${ticketId}.`,
      );
      return; // Não faz nada se não houver mensagens do cliente
    }

    // Limpar a mensagem antes de processar
    const mensagemLimpa = limparMensagem(primeiraMensagem.message);

    // Log da mensagem limpa (o que o processador realmente leu)
    console.log(`mensagem lida: ${cortarMensagemUtil(mensagemLimpa)}`);

    // Verifica se a mensagem limpa ainda tem conteúdo
    if (!mensagemLimpa) {
      console.log(
        `❌ A mensagem do ticket ${ticketId} foi removida após a limpeza.`,
      );
      return;
    }

    const lastUpdateTime = new Date(ticket.last_update_timestamp * 1000);
    const lastExecTime = new Date(lastExecution);

    // Verifica se o ticket foi atualizado após a última execução
    if (lastUpdateTime <= lastExecTime) {
      console.log(
        `Ticket ID ${ticketId} não tem novas atualizações após a última execução.`,
      );
      return; // Não processa se não houver atualizações novas
    }

    // Detectar o idioma da primeira mensagem do cliente
    const idiomaDetectado = await detectLanguage([primeiraMensagem]);

    // Extraindo os Order IDs diretamente usando a função `extrairTodosOrderIds`
    const orderIdsExtraidos = extrairTodosOrderIds(mensagemLimpa);
    console.log(
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
      console.log(
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
      console.log(
        `❓ [processarTicket] Ticket ID ${ticketId} não contém Order ID. Solicitando ao cliente...`,
      );

      // Solicita o Order ID
      const mensagemSolicitacao = await gerarMensagemSolicitandoOrderId(
        idiomaDetectado,
      );
      console.log(
        `❓ [processarTicket] Solicitando Order ID ao cliente no Ticket ID ${ticketId}.`,
      );
      await responderTicket(ticketId, mensagemSolicitacao);

      // Registra a solicitação no Google Sheets
      await registrarNoGoogleSheets({
        orderId: 'Não informado',
        mensagemDoCliente: primeiraMensagem.message,
        lastMessage: mensagemSolicitacao,
      });

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
          console.log(`❌ Pedido ID ${orderId} não encontrado.`);
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
        console.log(
          `❌ Erro ao buscar o pedido ID ${orderId}: ${error.message}`,
        );
      }
    }

    // Garante que estamos pegando a primeira mensagem real do cliente
    const mensagensDoCliente = messages.filter(
      (mensagem) => mensagem.sender === 'client' || !mensagem.is_staff,
    );

    console.log(
      `📥 Mensagens do cliente encontradas:`,
      mensagensDoCliente.map((m) => m.message),
    );

    // Função local para remover tags HTML e números no início
    function tirarNumero(mensagem) {
      if (!mensagem) return '';

      // 1. Remove tags HTML (ex: <div>, <br>, etc)
      mensagem = mensagem.replace(/<[^>]*>/g, ' ');

      // 2. Separa números colados com letras
      mensagem = mensagem.replace(/(\d+)([a-zA-Z]+)/g, '$1 $2'); // número + letras
      mensagem = mensagem.replace(/([a-zA-Z]+)(\d+)/g, '$1 $2'); // letras + número

      // 3. Remove caracteres especiais e números
      mensagem = mensagem.replace(/[^a-zA-ZÀ-ÿ\s]/g, '');

      // 4. Remove espaços duplicados e trim
      mensagem = mensagem.replace(/\s+/g, ' ').trim();

      // 5. Converte para minúsculas
      return mensagem.toLowerCase();
    }

    // Pega a primeira mensagem e processa
    const primeiraMensagemBruta =
      mensagensDoCliente?.[0]?.message || 'Mensagem não encontrada';
    const mensagemCortada = cortarMensagemUtil(primeiraMensagemBruta);
    const primeiraMensagemDoCliente = tirarNumero(mensagemCortada);

    console.log(
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

    console.log(`✉️ [processarTicket] Resposta gerada: ${respostaFinal}`);

    // Envia a resposta ao cliente
    if (respostaFinal) {
      console.log(
        `📝 [processarTicket] Enviando resposta para o ticket ${ticketId}`,
      );
      await responderTicket(ticketId, respostaFinal);

      // Registrar a resposta (última mensagem enviada) no Google Sheets
    }

    // Registrar os dados para todos os Order IDs extraídos
    for (const orderId of orderIdsExtraidos) {
      try {
        let orderData = await buscarStatusPedido(orderId);
        if (!orderData) {
          console.log(`❌ Pedido ID ${orderId} não encontrado.`);
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
          mensagemDoCliente: primeiraMensagemDoCliente,
          lastMessage: respostaFinal,
        });

        console.log(
          `📊 Registro no Google Sheets: ✅ Sucesso para o Pedido ID ${orderId}`,
        );
      } catch (error) {
        console.log(`📊 Registro no Google Sheets: ❌ Erro - ${error.message}`);
      }
    }

    console.log('------------------------------------------------------------');
  } catch (error) {
    console.log(`❌ Erro ao processar o ticket ${ticketId}: ${error.message}`);
  }
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
