const axios = require('axios');
const logger = require('../logger'); // Sistema de logs
const {
  removerTagsHTML,
  extrairOrderIdDaMensagem,
  buscarStatusPedido,
  responderTicket,
} = require('./apiService'); // Funções de utilidades para limpeza de texto e extração do Order ID

// Adicione essa função no início ou final do arquivo iaSolicitacao.js

// Função para extrair múltiplos Order IDs

function extrairTodosOrderIds(mensagem) {
  if (!mensagem) return [];

  // Alteração na regex para capturar apenas sequências de 6 dígitos
  const regexOrderId = /<div><b>Order ID<\/b>: (\d{6})<\/div>/g; // 6 dígitos
  let orderIds = [];
  let match;

  // Usar o regex para capturar os Order IDs dentro das tags <div><b>Order ID</b>:
  while ((match = regexOrderId.exec(mensagem)) !== null) {
    orderIds.push(match[1]); // Adiciona os IDs encontrados
  }

  // Se não encontrar IDs diretamente, tentamos capturar qualquer sequência numérica de 6 dígitos
  if (orderIds.length === 0) {
    const regexForaDeTags = /\b\d{6}\b/g; // Captura apenas números de 6 dígitos
    orderIds = [...new Set(mensagem.match(regexForaDeTags) || [])]; // Adiciona IDs encontrados fora das tags
  }

  // Caso haja IDs concatenados, separe-os (como no caso de 550039550039)
  const orderIdsSeparados = [];
  for (const orderId of orderIds) {
    if (orderId.length >= 12) {
      // Se o ID for maior que 12 dígitos, dividimos em dois IDs de 6 dígitos cada
      const partes = orderId.match(/(\d{6})(\d{6})/);
      if (partes) {
        orderIdsSeparados.push(partes[1], partes[2]);
      } else {
        orderIdsSeparados.push(orderId); // Se não puder ser dividido, adiciona como está
      }
    } else {
      orderIdsSeparados.push(orderId); // Adiciona IDs válidos de 6 dígitos
    }
  }

  // Remover IDs duplicados
  const orderIdsUnicos = [...new Set(orderIdsSeparados)];

  console.log('-----------extrairTodosOrdersID');
  console.log('✅ Order IDs extraídos:', orderIdsUnicos);
  return orderIdsUnicos;
}

async function processarOrderIds(
  ticketId,
  tipoSolicitacao,
  mensagem,
  idiomaDetectado,
) {
  const orderIds = extrairTodosOrderIds(mensagem); // Extrai todos os Order IDs da mensagem
  console.log(
    `📦 [processarOrderIds] Order IDs extraídos: ${orderIds.join(', ')}`,
  );

  if (orderIds.length === 0) {
    console.log(`❌ Nenhum Order ID encontrado no ticket ${ticketId}`);
    return `No Order IDs were found in the message.`;
  }

  let pedidosAptos = [];
  let pedidosNaoAptos = [];
  let mensagemRespostas = '';
  const orderIdsProcessados = new Set(); // Conjunto para verificar se o Order ID já foi processado

  // Processa cada Order ID
  for (const orderId of orderIds) {
    if (orderIdsProcessados.has(orderId)) {
      console.log(`🚫 Order ID ${orderId} já foi processado, ignorando.`);
      continue;
    }

    orderIdsProcessados.add(orderId);

    let orderData = await buscarStatusPedido(orderId);
    if (!orderData) {
      pedidosNaoAptos.push({ orderId, motivo: 'Não encontrado' });
      continue;
    }

    if (orderData.status === 'canceled') {
      pedidosNaoAptos.push({ orderId, motivo: 'Pedido já cancelado' });
    } else if (orderData.status === 'completed') {
      pedidosNaoAptos.push({ orderId, motivo: 'Pedido já completo' });
    } else {
      pedidosAptos.push(orderId);
    }
  }

  // Gerando a resposta para o cliente
  if (pedidosAptos.length > 0) {
    mensagemRespostas += `The following Order IDs have been sent for speed-up: ${pedidosAptos.join(
      ', ',
    )}.\n\n`;
  }

  if (pedidosNaoAptos.length > 0) {
    mensagemRespostas += `The following Order IDs were not processed:\n`;
    pedidosNaoAptos.forEach((pedido) => {
      mensagemRespostas += `Order ID ${pedido.orderId} - Reason: ${pedido.motivo}\n`;
    });
  }

  // Verifique se a resposta já foi enviada
  let respostaEnviada = false;

  // Enviar a resposta ao cliente
  if (!respostaEnviada) {
    console.log(`-----------ProcessarOdersID-----------`);
    console.log(
      `Resposta enviada para o ticket ${ticketId}: ${mensagemRespostas}`,
    );
    await responderTicket(ticketId, mensagemRespostas);
    respostaEnviada = true; // Marca a resposta como enviada
  }

  return mensagemRespostas;
}

function cortarMensagemUtil(mensagemOriginal) {
  console.log(`-------------CORTAR MENSAGEM -------------------`);
  console.log(`📜 Mensagem original: "${mensagemOriginal}"`);

  // Encontrar a posição da primeira tag </b>
  const primeiraTagFechamento = mensagemOriginal.indexOf('</b>'); // Encontra a primeira tag </b>

  if (primeiraTagFechamento === -1) {
    // Se não encontrar a tag </b>, retorna a mensagem original
    console.log(
      `⚡ Não foi possível localizar a tag </b>, retornando a mensagem original.`,
    );
    return mensagemOriginal;
  }

  // Encontrar a posição da segunda tag </b>
  let segundaTagFechamento = mensagemOriginal.indexOf(
    '</b>',
    primeiraTagFechamento + 1,
  );

  // Caso a segunda tag </b> não exista, tentamos retornar a partir da primeira
  if (segundaTagFechamento === -1) {
    console.log(
      `⚡ Segunda tag </b> não encontrada, utilizando a primeira tag </b> para cortar a mensagem.`,
    );
    // Caso não tenha a segunda tag </b>, retornamos o restante da mensagem a partir da primeira
    return mensagemOriginal.slice(primeiraTagFechamento + 4).trim();
  }

  // Caso encontre a segunda tag </b>, cortamos a partir dela
  let cortadaComTags = mensagemOriginal.slice(segundaTagFechamento + 4).trim(); // Pula a segunda tag </b> e mantém o resto

  // Remover as tags HTML da mensagem cortada
  //const cortadaSemTags = cortadaComTags.replace(/<\/?[^>]+(>|$)/g, '').trim();

  console.log(`🔧 Mensagem cortada: "${cortadaComTags}"`);
  return cortadaComTags;
}

async function classificarCategoriaGeral(mensagemOriginal) {
  // Chama a função cortarMensagemUtil diretamente para obter a mensagem cortada corretamente
  const mensagemCortada = cortarMensagemUtil(mensagemOriginal); // A mensagem cortada já está aqui

  // Verifica se `mensagemCortada` está em um formato esperado
  console.log(`------- CLASSIFICAR CATEGORIA ------------`);
  console.log(`✂️ classificar:  Mensagem cortada (útil): "${mensagemCortada}"`);

  // Refinando o prompt para a IA, deixando claro que a palavra "cancelar" se refere a um pedido
  const prompt = `
    Você é um assistente de suporte multilíngue. Sua tarefa é classificar a mensagem do cliente como "Pedido", "Pagamento" ou "Outro", com base no conteúdo da mensagem.

    
    1. **"Pedido"** – Se a mensagem for sobre qualquer aspecto de um pedido, como cancelamento, aceleração, status, garantia, refil, ou entrega.
       - A IA deve identificar que, mesmo sem o **Order ID**, a mensagem é sobre um pedido. 
       - **Se a mensagem contiver "Speed" ou "SpeedUp"**, isso deve ser automaticamente classificado como "Pedido", **mesmo sem o número do pedido presente**. Exemplo: "Speed", "SpeedUp", "Please speed up my order", "I need to speed my request", "18575speed", entre outros.

    2. "Pagamento" – se a mensagem for sobre questões financeiras, como valor, fatura, cobrança, saldo, cartão, comprovante de pagamento, falha no pagamento, etc.
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

    // Verificar se o resultado está dentro das categorias esperadas
    if (!['Pedido', 'Pagamento', 'Outro'].includes(resultado)) {
      console.log(`⚠️ Resposta inesperada da IA: ${resultado}`);
      return 'Outro'; // fallback seguro para retornar "Outro" caso não identifique uma categoria válida
    }
    console.log(`🎯 Categoria classificada pela IA: ${resultado}`);
    return resultado; // Retorna a categoria classificada
  } catch (error) {
    logger.error('Erro ao classificar categoria geral:', error.message);
    return 'Outro'; // Retorna "Outro" como fallback seguro se houver erro durante a classificação
  }
}

// Função para detectar o idioma usando a OpenAI
// Função para detectar o idioma usando a OpenAI
async function detectLanguage(messages) {
  if (!Array.isArray(messages)) {
    logger.error(
      'O parâmetro messages não é um array. Convertendo para array.',
    );
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
    logger.error('Nenhuma mensagem útil encontrada para análise.');
    return 'en';
  }

  // 🔍 Aplica o corte inteligente da mensagem apenas uma vez
  const mensagemCortada = cortarMensagemUtil(ultimaMensagemUtil.message); // A versão cortada da mensagem já é gerada aqui

  // Mostra no log a diferença
  console.log(`---------- DetectLanguage------------`);
  console.log(`✂️ Mensagem cortada (útil): "${mensagemCortada}"`);

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
      console.log('❌ Idioma não identificado, usando fallback pt');
      return 'en';
    }

    console.log(`🌐 Idioma detectado: ${idiomaDetectado}`);
    return idiomaDetectado;
  } catch (error) {
    console.log('❌ Erro na detecção de idioma:', error.message);
    return 'en';
  }
}

async function traduzirTexto(texto, idiomaDestino) {
  if (!idiomaDestino) {
    logger.error('Idioma de destino não especificado para tradução.');
    return texto; // Retorna o texto original se não houver idioma de destino
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini-2024-07-18', // Modelo da OpenAI
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
      return response.data.choices[0].message.content.trim(); // Retorna a tradução
    } else {
      throw new Error('Resposta da IA não está no formato esperado.');
    }
  } catch (error) {
    logger.error('Erro ao traduzir com OpenAI:', error.message);
    return texto; // Retorna o texto original em caso de erro
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
    logger.error(
      'Erro ao gerar mensagem de solicitação de Order ID:',
      error.message,
    );
    return textoBase;
  }
}

// Função para gerar a solicitação à IA
async function verificarTipoDeSolicitacao(messages) {
  // Filtra as últimas 3 mensagens do cliente
  const mensagensCliente = messages
    .filter((msg) => msg.message && !msg.is_staff)
    .slice(-3); // Últimas 3 mensagens

  // Junta as mensagens para uma única string
  const messageText = mensagensCliente
    .map((msg) => msg.message.trim()) // Não remove tags HTML antes
    .join(' ');

  // Aplica o corte na mensagem, mantendo as tags intactas
  const mensagemCortada = cortarMensagemUtil(messageText); // Chama a função de corte uma vez

  // **Log para ver a mensagem cortada antes da classificação**
  console.log(`------ VERIFICAR TIPO DE SOLICITACAO ----------`);
  console.log(
    `📜 [verificarTipoDeSolicitacao] Analisando a mensagem do cliente: "${mensagemCortada}"`,
  );

  // Detectar idioma (continua sendo útil para tradução futura)
  const idiomaDetectado = await detectLanguage(messages); // Usa a mensagem cortada para detectar o idioma

  // ✅ Classifica a categoria geral do ticket usando a mensagem cortada
  const categoria = await classificarCategoriaGeral(mensagemCortada); // Passa a mensagem cortada para a classificação
  console.log(
    `🎯 [verificarTipoDeSolicitacao] Categoria geral detectada: ${categoria}`,
  );

  if (categoria === 'Pagamento' || categoria === 'Outro') {
    // Ignorar processamento se for relacionado a "Pagamento" ou "Outro"
    console.log(
      `🚫 [verificarTipoDeSolicitacao] Ticket relacionado a "Pagamento" ou "Outro". Ignorando.`,
    );
    return { tipoSolicitacao: categoria, orderIds: [] }; // Retorna um array vazio de orderIds
  }

  // ✅ Continua apenas se for relacionado a Pedido
  const orderIds = extrairTodosOrderIds(mensagemCortada); // Passa a versão cortada da mensagem

  // **Log para ver o que aconteceu com os Order IDs extraídos**
  if (orderIds.length === 0) {
    console.log(
      `❗ [verificarTipoDeSolicitacao] Pedido identificado, mas sem Order ID. Solicitando o Order ID ao cliente.`,
    );
  } else {
    console.log(
      `✅ [verificarTipoDeSolicitacao] Order ID(s) extraído(s): ${orderIds.join(
        ', ',
      )}`,
    );
  }

  if (orderIds.length === 0) {
    // Se não houver Order ID, solicita o Order ID
    const mensagemSolicitacao = await gerarMensagemSolicitandoOrderId(
      idiomaDetectado,
    );
    console.log(
      `❓ [verificarTipoDeSolicitacao] Solicitando Order ID ao cliente. Enviar a mensagem para o cliente.`,
    );

    return { tipoSolicitacao: 'Pedido', orderIds: [] }; // Retorna vazio, pois o cliente precisa fornecer o Order ID
  }

  // 🔄 Identificar a intenção dentro do contexto do pedido usando a mensagem cortada
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

    const tipo = response.data.choices[0].message.content.trim();

    // Verificar a resposta para garantir que "Aceleração" é reconhecida corretamente
    if (tipo === 'speedup') {
      return { tipoSolicitacao: 'Aceleração', orderIds };
    }

    return { tipoSolicitacao: tipo, orderIds };
  } catch (error) {
    console.log(
      `❌ Erro ao identificar tipo dentro de "Pedido": ${error.message}`,
    );
    return { tipoSolicitacao: 'Outro', orderIds }; // Retorna "Outro" caso falhe na classificação
  }
  // Log final para identificar o tipo de solicitação
  console.log(
    `🔍 [verificarTipoDeSolicitacao] Tipo de solicitação final: ${categoria}`,
  );
}

async function gerarRespostaFinal(
  ticketId,
  tipoSolicitacao,
  orderIds, // Agora, a variável orderIds será sempre um array
  orderDataList, // Agora, isso será uma lista de objetos contendo os dados de cada pedido
  idiomaDetectado,
  nomeAtendente = 'Marcelle', // Nome do atendente
  linkRevendedor = 'https://smmexcellent.com/child-panel',
  linkAfiliado = 'https://smmexcellent.com/affiliates',
) {
  console.log('---------- GERAR RESPOSTA FINAL ------------');

  let respostaIA = '';
  let pedidosAptos = [];
  let pedidosNaoAptos = [];

  // Remover Order IDs duplicados
  const orderIdsUnicos = [...new Set(orderIds)]; // Agora a variável `orderIdsUnicos` é usada aqui

  if (!Array.isArray(orderDataList)) {
    orderDataList = [orderDataList]; // Caso apenas um pedido tenha sido passado
  }

  // Iniciando a resposta com uma saudação
  const nomeUsuario = orderDataList[0]?.user; // Atribuindo o nome do usuário de `orderDataList`

  if (!nomeUsuario) {
    console.log('❌ Nome do usuário não encontrado.');
    return 'Erro: Nome do usuário não encontrado.';
  }

  respostaIA += `Hello ${nomeUsuario},\n\n`; // Saudação personalizada com nome do usuário

  // Processando todos os pedidos
  for (const orderData of orderDataList) {
    if (!orderData || !orderData.status) {
      console.log(`❌ Dados inválidos para o pedido ${orderData.orderId}.`);
      pedidosNaoAptos.push({
        orderId: orderData.orderId,
        motivo: 'Dados incompletos',
      });
      continue;
    }

    // Gerar a resposta para cada pedido com mais detalhes
    if (tipoSolicitacao === 'Cancelamento') {
      if (orderData.status === 'canceled') {
        respostaIA += `Your order <strong>ID ${orderData.orderId}</strong> has already been <strong>canceled</strong>, as requested. You can place a new order at any time.\n\n`;
      } else if (orderData.status === 'completed') {
        respostaIA += `Your order <strong>ID ${orderData.orderId}</strong> is already <strong>complete</strong>. We cannot cancel an order that has already been completed.\n\n`;
      } else {
        respostaIA += `The <strong>cancellation</strong> request for your order <strong>ID ${orderData.orderId}</strong> has been forwarded to the responsible team. Your order will be canceled soon.\n\n`;
      }
    } else if (tipoSolicitacao === 'Aceleração') {
      if (orderData.status === 'completed') {
        respostaIA += `Your order <strong>ID ${orderData.orderId}</strong> is already <strong>complete</strong>. We cannot expedite an order that has already been completed.\n\n`;
      } else if (orderData.status === 'canceled') {
        respostaIA += `Your order <strong>ID ${orderData.orderId}</strong> has been <strong>canceled</strong>. We cannot expedite an order that has been canceled.\n\n`;
      } else {
        respostaIA += `Your <strong>acceleration</strong> request has been forwarded to the responsible team. We will try to expedite your order <strong>ID ${orderData.orderId}</strong>.\n\n`;
      }
    } else if (tipoSolicitacao === 'Refil/Garantia') {
      respostaIA += `I’ve forwarded your refill or warranty request to our specialized technical team for analysis. If your request is eligible, the refill or warranty will be processed within 0–48h after approval. \nIf you need anything else, don’t hesitate to contact us again\n\n`;
    } else {
      respostaIA += `Your request will be forwarded to our specialized technical team for analysis. We will contact you soon.\n\n`;
    }
  }

  // **Conclusion and links**
  respostaIA += `---\nIf you need more information, we are available to help.\n\nBest regards,\n\n${nomeAtendente}\n\n`;
  respostaIA += `➕ Join us as a reseller for just $25 - [Reseller Link](${linkRevendedor})\n`;
  respostaIA += `➕ Invite friends, share your link, and earn! - [Affiliate Link](${linkAfiliado})\n`;

  // **A tradução só acontece se o idioma detectado não for inglês**
  let respostaTraduzida = respostaIA;
  if (idiomaDetectado !== 'en') {
    console.log(`🌍 Traduzindo a resposta para o idioma: ${idiomaDetectado}`);
    respostaTraduzida = await traduzirTexto(respostaIA, idiomaDetectado); // Traduz apenas se não for inglês
  }

  // Retornamos a resposta gerada, sem enviar diretamente
  return respostaTraduzida;
}

module.exports = {
  gerarRespostaFinal,
  verificarTipoDeSolicitacao,
  detectLanguage,
  traduzirTexto,
  gerarMensagemSolicitandoOrderId,
  extrairTodosOrderIds,
  processarOrderIds,
  cortarMensagemUtil,
};
