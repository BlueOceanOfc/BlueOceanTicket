const axios = require('axios');
const logger = require('./logger'); // Sistema de logs
const {
  removerTagsHTML,
  extrairOrderIdDaMensagem,
} = require('./services/apiService'); // Funções de utilidades para limpeza de texto e extração do Order ID

// Função para detectar o idioma usando a OpenAI
// Função para detectar o idioma usando a OpenAI
async function detectLanguage(messages) {
  if (!Array.isArray(messages)) {
    logger.error(
      'O parâmetro messages não é um array. Convertendo para array.',
    );
    messages = Array.isArray(messages) ? messages : [messages];
  }

  // Pega a última mensagem útil com mais de 5 caracteres
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
    return 'en'; // Fallback para inglês, caso não consiga detectar o idioma
  }

  const texto = removerTagsHTML(ultimaMensagemUtil.message).toLowerCase();
  console.log(`🧠 Texto extraído para detecção de idioma: "${texto}"`);

  try {
    // Usando o modelo para detectar o idioma
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions', // Endpoint da OpenAI
      {
        model: 'gpt-4o-mini-2024-07-18', // O modelo da OpenAI
        messages: [
          {
            role: 'system',
            content: `Identifique o idioma do seguinte texto e retorne apenas o código do idioma (por exemplo, 'en' para inglês, 'pt' para português): "${texto}"`,
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

    // Se a OpenAI não conseguir identificar corretamente o idioma, retorna 'pt' como fallback
    if (!idiomaDetectado || idiomaDetectado === 'und') {
      console.log('❌ Não foi possível identificar o idioma com a OpenAI.');
      return 'pt'; // Fallback para português
    }

    console.log(`🌐 Idioma detectado: ${idiomaDetectado}`);

    return idiomaDetectado; // Retorna o código do idioma detectado
  } catch (error) {
    console.log('❌ Erro ao interagir com a OpenAI:', error.message);
    return 'pt'; // Em caso de erro, retorna 'pt' como fallback
  }
}

// Função para traduzir o texto usando a OpenAI
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
            content: `Você é um tradutor. Sua tarefa é traduzir o texto solicitado para o idioma ${idiomaDestino}.`,
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

// Função para gerar a solicitação à IA
async function verificarTipoDeSolicitacao(messages) {
  // Filtra as mensagens e as concatena em um único texto

  // Pega apenas as últimas 3 mensagens do cliente (não staff)
  const mensagensCliente = messages
    .filter((msg) => msg.message && !msg.is_staff)
    .slice(-3); // Últimas 3

  const messageText = mensagensCliente
    .map((msg) => removerTagsHTML(msg.message).toLowerCase())
    .join(' ');

  // Verifica se o texto das mensagens é válido
  if (!messageText || messageText.trim() === '') {
    logger.error('Erro: O texto das mensagens está vazio ou inválido.');
    throw new Error('Texto das mensagens vazio ou inválido.');
  }

  const ultimaMensagem = messages
    .slice()
    .reverse()
    .find(
      (msg) => msg.message && !msg.is_staff && msg.message.trim().length > 0,
    );

  if (ultimaMensagem) {
  }

  // Antes de enviar o texto para IA, vamos garantir que extraímos o Order ID
  const orderId = extrairOrderIdDaMensagem(messages);
  console.log(`🆔 Order ID extraído: ${orderId}`);

  // Caso o Order ID não seja encontrado, retornamos erro ou solicitamos ao cliente
  if (!orderId) {
    console.timeLog(
      '❌ Erro: Não foi possível extrair o Order ID das mensagens.',
    );
    return { tipoSolicitacao: 'Outro', orderId: null }; // Retorna null para indicar que o Order ID não foi encontrado
  }

  // O prompt que será enviado à IA
  const prompt = `
    O cliente interagiu com o suporte. A solicitação pode ser sobre:
    - Cancelamento de pedido
    - Aceleração (Speedup) de pedido
    - Refil ou Garantia
    - Outros assuntos gerais relacionados ao pedido.

    Com base nas mensagens a seguir, determine a intenção do cliente.
    
    Mensagens do cliente:
    ${messageText}

    Identifique o tipo de solicitação (Aceleração, Cancelamento, Refil/Garantia, Outro).
    Responda apenas com o tipo de solicitação: Aceleração, Cancelamento, Refil/Garantia ou Outro.
    `;

  // Faz a requisição para a IA com o prompt
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions', // Endpoint da OpenAI
      {
        model: 'gpt-4o-mini-2024-07-18', // O modelo da IA que será utilizado
        messages: [
          {
            role: 'system',
            content: `Você é um assistente de suporte. Seu objetivo é identificar a solicitação do cliente com base nas mensagens e categorizar como: Aceleração, Cancelamento, Refil/Garantia ou Outro.`,
          },
          {
            role: 'user',
            content: prompt, // O prompt estruturado com base nas mensagens
          },
        ],
        max_tokens: 280,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, // Sua chave da OpenAI
          'Content-Type': 'application/json',
        },
      },
    );

    // Retorna o tipo de solicitação (Aceleração, Cancelamento, Refil/Garantia ou Outro)
    const tipoSolicitacao = response.data.choices[0].message.content.trim();
    return { tipoSolicitacao, orderId };
  } catch (error) {
    if (error.response && error.response.status === 429) {
      const retryAfter = error.response.headers['retry-after'];

      const tempoEspera =
        retryAfter && !isNaN(retryAfter) ? parseInt(retryAfter) : 10; // Padrão: espera 10 segundos

      console.log(
        `⚠️ Limite de requisições da OpenAI atingido (Erro 429). Aguarde ${tempoEspera} segundos para tentar novamente.`,
      );

      // Aguarda o tempo necessário e tenta de novo
      await new Promise((resolve) => setTimeout(resolve, tempoEspera * 1000));

      // Tenta novamente recursivamente (1 vez)
      return await verificarTipoDeSolicitacao(messages);
    }

    console.log(
      `❌ Ocorreu um erro ao tentar identificar o tipo de solicitação: ${error.message}`,
    );
    throw new Error('Erro ao verificar o tipo de solicitação com a IA.');
  }
}

// Função para gerar a resposta final com base no tipo de solicitação
async function gerarRespostaFinal(
  ticketId,
  tipoSolicitacao,
  orderId,
  orderData,
  idiomaDetectado,
) {
  let respostaIA = '';

  // Verifica o tipo de solicitação

  if (tipoSolicitacao === 'Cancelamento') {
    if (orderData.status === 'canceled') {
      respostaIA = `Olá ${orderData.user},\n\nSeu pedido *ID ${orderId}* já foi *cancelado*, conforme solicitado. Você pode fazer um novo pedido a qualquer momento.\n\nAtenciosamente,\n\nDavid\n\n➕ Junte-se a nós como revendedor por apenas $25 - [Link de Revenda](https://smmexcellent.com/child-panel)\n➕ Convide amigos, compartilhe seu link e ganhe! - [Link de Afiliados](https://smmexcellent.com/affiliates)`;
    } else if (orderData.status === 'completed') {
      respostaIA = `Olá ${orderData.user},\n\nO seu pedido *ID ${orderId}* já está *completo*. Não podemos cancelar um pedido que já foi finalizado.\n\nAtenciosamente,\n\nDavid\n\n➕ Junte-se a nós como revendedor por apenas $25 - [Link de Revenda](https://smmexcellent.com/child-panel)\n➕ Convide amigos, compartilhe seu link e ganhe! - [Link de Afiliados](https://smmexcellent.com/affiliates)`;
    } else {
      respostaIA = `Olá ${orderData.user},\n\nA solicitação de *cancelamento* do seu pedido *ID ${orderId}* foi encaminhada à equipe responsável. Seu pedido será cancelado em breve.\n\nAtenciosamente,\n\nDavid\n\n➕ Junte-se a nós como revendedor por apenas $25 - [Link de Revenda](https://smmexcellent.com/child-panel)\n➕ Convide amigos, compartilhe seu link e ganhe! - [Link de Afiliados](https://smmexcellent.com/affiliates)`;
    }
  } else if (tipoSolicitacao === 'Aceleração') {
    if (orderData.status === 'completed') {
      respostaIA = `Olá ${orderData.user},\n\nSeu pedido *ID ${orderId}* já está *completo*. Não é possível acelerar um pedido que já foi concluído.\n\nAtenciosamente,\n\nDavid\n\n➕ Junte-se a nós como revendedor por apenas $25 - [Link de Revenda](https://smmexcellent.com/child-panel)\n➕ Convide amigos, compartilhe seu link e ganhe! - [Link de Afiliados](https://smmexcellent.com/affiliates)`;
    } else if (orderData.status === 'canceled') {
      respostaIA = `Olá ${orderData.user},\n\nO seu pedido *ID ${orderId}* foi *cancelado*. Não podemos acelerar um pedido que foi cancelado.\n\nAtenciosamente,\n\nDavid\n\n➕ Junte-se a nós como revendedor por apenas $25 - [Link de Revenda](https://smmexcellent.com/child-panel)\n➕ Convide amigos, compartilhe seu link e ganhe! - [Link de Afiliados](https://smmexcellent.com/affiliates)`;
    } else {
      respostaIA = `Olá ${orderData.user},\n\nA sua solicitação de aceleração foi encaminhada para a nossa equipe responsável. Vamos tentar acelerar o seu pedido **ID ${orderId}**.\n\nAtenciosamente,\n\nDavid\n\n➕ Junte-se a nós como revendedor por apenas $25 - [Link de Revenda](https://smmexcellent.com/child-panel)\n➕ Convide amigos, compartilhe seu link e ganhe! - [Link de Afiliados](https://smmexcellent.com/affiliates)`;
    }
  } else if (tipoSolicitacao === 'Refil/Garantia') {
    respostaIA = `Olá ${orderData.user},\n\nA sua solicitação de *refil* ou *garantia* será encaminhada para a nossa equipe técnica especializada para análise.\n\nAtenciosamente,\n\nDavid\n\n➕ Junte-se a nós como revendedor por apenas $25 - [Link de Revenda](https://smmexcellent.com/child-panel)\n➕ Convide amigos, compartilhe seu link e ganhe! - [Link de Afiliados](https://smmexcellent.com/affiliates)`;
  } else {
    respostaIA = `Olá ${orderData.user},\n\nSua solicitação não está diretamente relacionada ao pedido. Encaminharemos para a nossa equipe técnica especializada para análise.\n\nAtenciosamente,\n\nDavid\n\n➕ Junte-se a nós como revendedor por apenas $25 - [Link de Revenda](https://smmexcellent.com/child-panel)\n➕ Convide amigos, compartilhe seu link e ganhe! - [Link de Afiliados](https://smmexcellent.com/affiliates)`;
  }

  // Traduzir a resposta para o idioma do cliente
  const respostaTraduzida = await traduzirTexto(respostaIA, idiomaDetectado);

  return respostaTraduzida;
}

module.exports = {
  gerarRespostaFinal,
  verificarTipoDeSolicitacao,
  detectLanguage,
};
