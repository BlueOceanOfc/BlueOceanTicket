const axios = require('axios');
const logger = require('../logger'); // Importa o logger para fazer os logs
const config = require('../config'); // Arquivo de configuração

// Função para gerar a resposta da IA
async function gerarRespostaIA(ticketText) {
  try {
    // Verifica se o ticketText é uma string válida e não está vazio
    if (typeof ticketText !== 'string' || ticketText.trim() === '') {
      throw new Error(
        'O texto do ticket está vazio ou não é uma string válida. Não é possível gerar uma resposta.',
      );
    }

    // Estrutura base para as interações, mantendo regras essenciais de forma simples
    const historicoInteracoes = [
      {
        role: 'system',
        content: `
          Você é um assistente de suporte para um e-commerce, com o objetivo de fornecer respostas rápidas e claras aos clientes sobre o status de seus pedidos.
          - Sempre solicite o OrderID quando não fornecido.
          - Se o pedido foi cancelado, informe ao cliente e não ofereça desculpas.
          - Se o pedido foi concluído, informe que não é possível fazer alterações.
          - Se o cliente solicitar aceleração de pedido, informe o status atual e tome as providências necessárias.
          - Responda na língua do cliente.
        `,
      },
      { role: 'user', content: ticketText }, // Texto do ticket
    ];

    // Limitar interações: enviar apenas as 3 últimas mensagens para reduzir o consumo de tokens
    const maxTokens = 250; // Limite máximo de tokens
    const promptTokens = calcularTokens(historicoInteracoes);

    if (promptTokens > maxTokens) {
      logger.info('Reduzindo histórico de interações para economizar tokens.');
      // Limitamos o histórico de interações para as últimas mensagens necessárias
      historicoInteracoes.splice(1, historicoInteracoes.length - 3); // Mantém só as 3 últimas interações
    }

    // Envia a solicitação para o OpenAI
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini-2024-07-18', // Modelo utilizado
        messages: historicoInteracoes, // Histórico de interações
        max_tokens: maxTokens, // Limite de tokens
        temperature: 0.7, // Criatividade da resposta
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    // Logando a resposta da IA
    logger.info('Resposta da IA recebida:', response.data);

    // Retorna a resposta gerada pela IA
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    logger.error('Erro ao chamar OpenAI:', error.message);
    throw new Error('Erro ao gerar resposta com a IA.');
  }
}

// Função para calcular o número de tokens utilizados no histórico de interações
function calcularTokens(historico) {
  let tokens = 0;
  for (const message of historico) {
    tokens += message.content.split(' ').length; // Estimando o número de tokens por palavras
  }
  return tokens;
}

module.exports = { gerarRespostaIA };
