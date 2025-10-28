import axios from 'axios';
import { logger } from '../logger.js';
import { buscarStatusPedido, responderTicket } from './apiService.js';
import {
  parseRawMessage, // << NOVO: Importação do parser robusto para aprimorar a extração
  formatIds,
  agruparPedidos,
} from './utils.js';

// Use logger para logs importantes, console.log para debug local
function debugLog(...args) {
  if (process.env.DEBUG_IA === 'true') {
    console.log(...args);
  }
}

// --- FLUXO PRINCIPAL: Geração da Resposta Final (Otimizada para processamento de pedidos) ---

async function gerarRespostaFinal(
  ticketId,
  tipoSolicitacao,
  orderIds, // Lista de IDs extraídos (já filtrados e priorizados pelo index.js)
  orderDataList, // Lista de dados do pedido (já buscados e agrupados no index.js)
  idiomaDetectado,
  nomeAtendente = 'Marcelle',
  linkRevendedor = 'https://smmexcellent.com/child-panel',
  linkAfiliado = 'https://smmexcellent.com/affiliates',
  options = {}, // { notFoundIds: [...] }
) {
  debugLog('---------- GERAR RESPOSTA FINAL ------------'); // A função processarOrderIds foi removida. A responsabilidade de buscar e agrupar // os dados dos pedidos (orderDataList) agora é do 'index.js', que faz isso // de forma mais eficiente (paralela se necessário) antes de chamar esta função.

  const orderIdsUnicos = [...new Set(orderIds)];

  if (!orderDataList || orderDataList.length === 0) {
    logger.error(
      `⚠️ Ticket ${ticketId}: orderDataList vazia. Resposta genérica.`,
    ); // Se não houver dados, retorna uma resposta baseada apenas no tipo.
    const respostaGenerica = `Hello,\n\nWe have received your ${tipoSolicitacao.toLowerCase()} request for order(s) ID ${formatIds(
      orderIdsUnicos,
    )}.\n\nWe are processing the request. If there are any issues, we will contact you immediately.\n\n`;
    let respostaTraduzidaGenerica = respostaGenerica;
    if (idiomaDetectado !== 'en') {
      respostaTraduzidaGenerica = await traduzirTexto(
        respostaGenerica,
        idiomaDetectado,
      );
    }
    return respostaTraduzidaGenerica;
  }
  const nomeUsuario = orderDataList[0]?.user || '';
  let respostaIA = `Hello ${nomeUsuario},\n\n`;

  const pedidosAgrupados = agruparPedidos(orderDataList);

  if (tipoSolicitacao === 'Cancelamento') {
    if (pedidosAgrupados.completed.length > 0) {
      respostaIA += `Your order(s) <strong>ID ${formatIds(
        pedidosAgrupados.completed,
      )}</strong> ${
        pedidosAgrupados.completed.length === 1 ? 'is' : 'are'
      } already <strong>complete</strong>. We cannot cancel order(s) that have already been completed.\n\n`;
    }

    if (pedidosAgrupados.canceled.length > 0) {
      respostaIA += `Your order(s) <strong>ID ${formatIds(
        pedidosAgrupados.canceled,
      )}</strong> ${
        pedidosAgrupados.canceled.length === 1 ? 'has' : 'have'
      } already been <strong>canceled</strong>, as requested. You can place a new order at any time.\n\n`;
    }

    if (pedidosAgrupados.pendente.length > 0) {
      respostaIA += `We have submitted your <strong>cancellation</strong> request for your order(s) <strong>ID ${formatIds(
        pedidosAgrupados.pendente,
      )}</strong>, and it is subject to approval. Please kindly wait while your request is reviewed.\n\n`;
    }
  } else if (tipoSolicitacao === 'Aceleração') {
    if (pedidosAgrupados.completed.length > 0) {
      respostaIA += `Your order(s) <strong>ID ${formatIds(
        pedidosAgrupados.completed,
      )}</strong> ${
        pedidosAgrupados.completed.length === 1 ? 'is' : 'are'
      } already <strong>complete</strong>. We cannot expedite order(s) that have already been completed.\n\n`;
    }

    if (pedidosAgrupados.canceled.length > 0) {
      respostaIA += `Your order(s) <strong>ID ${formatIds(
        pedidosAgrupados.canceled,
      )}</strong> ${
        pedidosAgrupados.canceled.length === 1 ? 'has' : 'have'
      } been <strong>canceled</strong>. We cannot expedite canceled order(s).\n\n`;
    }

    if (pedidosAgrupados.pendente.length > 0) {
      respostaIA += `Your <strong>acceleration</strong> request has been forwarded. We will try to expedite the order(s) <strong>ID ${formatIds(
        pedidosAgrupados.pendente,
      )}</strong> as soon as possible.\n\n`;
    }
  } else if (tipoSolicitacao === 'Refil/Garantia') {
    respostaIA += `I have forwarded your refill/warranty request for order(s) <strong>ID ${formatIds(
      orderIdsUnicos,
    )}</strong> to our technical team.\n\nTo be eligible for a refill, the current count must be above the start count and below the end count, and the order must be within the warranty/refill period described in the service.\n\nIf approved, the process will be completed within 1 to 3 days.\n\nIf you need anything else, feel free to contact us again.\n\n`;
  } else {
    // Diversos ou outros tipos de pedido
    respostaIA += `Your request has been forwarded to our specialized technical team for analysis. We will contact you soon regarding order(s) <strong>ID ${formatIds(
      orderIdsUnicos,
    )}</strong>.\n\n`;
  }

  if (pedidosAgrupados.invalidos.length > 0) {
    respostaIA += `Some order(s) could not be processed due to missing or invalid information: <strong>ID ${formatIds(
      pedidosAgrupados.invalidos,
    )}</strong>.\n\n`;
  }

  // If index.js passed notFoundIds (order IDs that the customer provided but were not
  // found in the system), explicitly inform the customer which IDs weren't found.
  if (options && Array.isArray(options.notFoundIds) && options.notFoundIds.length > 0) {
    respostaIA += `Additionally, the following order ID(s) you provided were not found in our system: <strong>ID ${formatIds(
      options.notFoundIds,
    )}</strong>. We processed the other valid order(s) above.

`;
  }

  respostaIA += `---\nIf you need more information, we are available to help.\n\nBest regards,\n\n${nomeAtendente}\n\n`;
  respostaIA += `➕ Join us as a reseller for just $25 - [Reseller Link](${linkRevendedor})\n`;
  respostaIA += `➕ Invite friends, share your link, and earn! - [Affiliate Link](${linkAfiliado})\n`;

  let respostaTraduzida = respostaIA;
  if (idiomaDetectado !== 'en') {
    respostaTraduzida = await traduzirTexto(respostaIA, idiomaDetectado);
  }

  return respostaTraduzida;
}

// --- CLASSIFICAÇÃO GERAL (Usa o parser robusto) ---

async function classificarCategoriaGeral(mensagemOriginal) {
  // Usa o parser robusto para obter o corpo limpo da mensagem
  const parsedMessage = parseRawMessage(mensagemOriginal);
  const mensagemCortada = parsedMessage.body;

  const prompt = `
    Você é um assistente de suporte multilíngue. Sua tarefa é classificar a mensagem do cliente como "Pedido", "Pagamento" ou "Outro", com base no conteúdo da mensagem.

    1. **"Pedido"** – Se a mensagem for sobre qualquer aspecto de um pedido, como cancelamento, aceleração, status, garantia, refil, ou entrega.
       - A IA deve identificar que, mesmo sem o **Order ID**, a mensagem é sobre um pedido. 
       - **Se a mensagem contiver "Speed" ou "SpeedUp"**, isso deve ser automaticamente classificado como "Pedido", **mesmo sem o número do pedido presente**. Exemplo: "Speed", "SpeedUp", "Please speed up my order", "I need to speed my request", "18575speed", entre outros.

    2. "Pagamento" – se a mensagem for sobre questões financeiras, como valor, desconto, fatura, cobrança, saldo, cartão, comprovante de pagamento, falha no pagamento, ou qualquer outro termo relacionado ao pagamento ou à transação financeira etc.
    3. "Outro" – se não for relacionado a pedidos ou pagamentos. Exemplos: perda de senha, suporte técnico, dúvidas gerais, reclamações, acesso à conta, etc.

    ⚠️ IMPORTANTE:
    - A mensagem pode ser em qualquer idioma — a IA deve ser capaz de entender isso.
    - Se a mensagem estiver relacionada a um **pedido**, mesmo sem o **Order ID**, classifique como "Pedido" e solicite ao cliente o **Order ID**.
    - Se a mensagem for sobre pagamento ou questões financeiras, classifique como "Pagamento".
    - Caso contrário, classifique como "Outro".

    Mensagem do cliente:
    """${mensagemCortada}"""
  `;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini-2024-07-18',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente de suporte. Classifique a mensagem como "Pedido", "Pagamento" ou "Outro".',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 10,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const resultado = response.data.choices[0].message.content.trim();

    if (!['Pedido', 'Pagamento', 'Outro'].includes(resultado)) {
      return 'Outro';
    }
    logger.info(`🎯 Categoria classificada pela IA: ${resultado}`);
    return resultado;
  } catch (error) {
    logger.error('❌ Erro [IA Classificação Geral]:', error.message);
    debugLog('Detalhes do erro:', error);
    return 'Outro';
  }
}

// --- DETECÇÃO DE IDIOMA (Usa o parser robusto) ---

async function detectLanguage(messages) {
  if (!Array.isArray(messages)) {
    messages = [messages];
  }

  const ultimaMensagemUtil = messages
    .slice()
    .reverse()
    .find(
      (msg) =>
        msg.message &&
        typeof msg.message === 'string' &&
        msg.message.trim().length > 5,
    );

  if (!ultimaMensagemUtil) {
    logger.error('Nenhuma mensagem útil encontrada para análise de idioma.');
    return 'en';
  } // Usa o parser robusto para obter o corpo limpo da mensagem

  const parsedMessage = parseRawMessage(ultimaMensagemUtil.message);
  const mensagemCortada = parsedMessage.body;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini-2024-07-18',
        messages: [
          {
            role: 'system',
            content: `Você é um assistente que deve identificar o idioma principal do texto a seguir. Retorne apenas o código do idioma (ex: 'pt', 'en', 'de'). Texto: "${mensagemCortada}"`,
          },
        ],
        max_tokens: 60,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const idiomaDetectado = response.data.choices[0].message.content.trim();
    if (!idiomaDetectado || idiomaDetectado === 'und') {
      return 'en';
    }

    return idiomaDetectado;
  } catch (error) {
    logger.error('❌ Erro [IA Detecção de Idioma]:', error.message);
    debugLog('Detalhes do erro:', error);
    return 'en';
  }
}

// --- TRADUÇÃO E SOLICITAÇÃO DE ID (Mantidas) ---

async function traduzirTexto(texto, idiomaDestino) {
  if (!idiomaDestino) {
    logger.error('Idioma de destino não especificado para tradução.');
    return texto;
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini-2024-07-18',
        messages: [
          {
            role: 'system',
            content: `Você é um tradutor. Sua tarefa é traduzir o texto solicitado para o idioma ${idiomaDestino}, preservando o significado e contexto, e considerando que pode haver mistura de línguas no texto. Traduza com precisão para o idioma ${idiomaDestino}.`,
          },
          {
            role: 'user',
            content: `Traduza o seguinte texto para o idioma ${idiomaDestino}: ${texto}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (response.data && response.data.choices && response.data.choices[0]) {
      return response.data.choices[0].message.content.trim();
    } else {
      throw new Error('Resposta da IA não está no formato esperado.');
    }
  } catch (error) {
    logger.error('❌ Erro [IA Tradução]:', error.message);
    debugLog('Detalhes do erro:', error);
    return texto;
  }
}

async function gerarMensagemSolicitandoOrderId(idiomaDestino = 'en') {
  const textoBase = `Hello, we require the *Order ID* in order to continue with your request. Please provide the *Order ID* so we can assist you further.

Best regards,

Marcelle

➕ Join us as a reseller for just $25 - [Reseller Link](https://smmexcellent.com/child-panel)
➕ Invite friends, share your link, and earn! - [Affiliate Link](https://smmexcellent.com/affiliates)`;

  if (idiomaDestino === 'en') {
    return textoBase;
  }

  try {
    const traduzido = await traduzirTexto(textoBase, idiomaDestino);
    return traduzido;
  } catch (error) {
    debugLog('Detalhes do erro:', error);
    return textoBase;
  }
}

// --- CLASSIFICAÇÃO DE TIPO DE PEDIDO (Usa o parser robusto) ---

async function verificarTipoDeSolicitacao(messages) {
  const mensagensCliente = messages
    .filter((msg) => msg.message && !msg.is_staff)
    .slice(-3);

  const messageText = mensagensCliente
    .map((msg) => msg.message.trim())
    .join(' '); // Usa o parser robusto para obter o corpo limpo da mensagem

  const parsedMessage = parseRawMessage(messageText);
  const mensagemCortada = parsedMessage.body; // 1. Classificação Categoria Geral

  const categoria = await classificarCategoriaGeral(mensagemCortada);

  if (categoria === 'Pagamento' || categoria === 'Outro') {
    return { tipoSolicitacao: categoria, orderIds: [] };
  }

  // 2. Extração de IDs (usando o parser)
  // Nota: A função extrairTodosOrderIds NÃO é necessária se você usar o parseRawMessage no index.js
  // Vamos manter a chamada para extração de IDs aqui por segurança de compatibilidade, mas o index.js é quem usa o parser completo
  // Para fins deste bloco, vamos simular a extração a partir do parseRawMessage.
  const orderIds = parsedMessage.orderIds.map((item) => item.id);

  if (orderIds.length === 0) {
    // Se for "Pedido" mas sem ID, o index.js decide se solicita o ID ou não.
    return { tipoSolicitacao: 'Pedido', orderIds: [] };
  }

  const prompt = `
    O cliente está solicitando suporte relacionado a um pedido. A solicitação pode ser:

    - Cancelamento
    - Aceleração
    - Refil/Garantia
    - Diversos (mas ainda dentro de "pedido")

    Com base nas mensagens abaixo, classifique a intenção do cliente:
    ${mensagemCortada}

    Responda com: Cancelamento, Aceleração, Refil/Garantia ou Diversos.
  `;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini-2024-07-18',
        messages: [
          {
            role: 'system',
            content: `Você é um assistente de suporte. Classifique a solicitação como: Cancelamento, Aceleração, Refil/Garantia ou Diversos.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 100,
        temperature: 0.5,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    let tipo = response.data.choices[0].message.content.trim(); // Pequena correção para garantir que a saída da IA se encaixe nas categorias.

    if (tipo.toLowerCase() === 'speedup') {
      tipo = 'Aceleração';
    }
    if (
      !['Cancelamento', 'Aceleração', 'Refil/Garantia', 'Diversos'].includes(
        tipo,
      )
    ) {
      tipo = 'Diversos';
    }

    return { tipoSolicitacao: tipo, orderIds };
  } catch (error) {
    logger.error('❌ Erro [IA Classificação Pedido]:', error.message);
    debugLog('Detalhes do erro:', error);
    return { tipoSolicitacao: 'Diversos', orderIds };
  }
}

export {
  gerarRespostaFinal,
  verificarTipoDeSolicitacao,
  detectLanguage,
  traduzirTexto,
  gerarMensagemSolicitandoOrderId, // extrairTodosOrderIds foi descontinuada aqui, mas é mantida no utils.js para o parseRawMessage // processarOrderIds foi descontinuada em favor do fluxo no index.js // cortarMensagemUtil foi descontinuada em favor do parseRawMessage
};
