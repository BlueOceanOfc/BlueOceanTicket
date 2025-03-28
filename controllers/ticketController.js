const { gerarRespostaIA } = require('../services/openAIService'); // Serviço para IA
const { buscarTicket, responderTicket } = require('../services/apiService'); // Serviço para API de tickets
const { registrarNoGoogleSheets } = require('../services/sheetsService'); // Serviço para registrar em Google Sheets

const processarTicket = async (req, res) => {
  const { ticketId } = req.body;

  // Verifica se o ticketId foi passado no corpo da requisição
  if (!ticketId) {
    return res.status(400).json({ error: 'ticketId é obrigatório' });
  }

  try {
    // Obtém os detalhes do ticket
    const ticket = await buscarTicket(ticketId);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket não encontrado' });
    }

    const ticketText = ticket.descricao; // Texto do ticket (ex: problema do cliente)

    console.log('Texto do ticket:', ticketText); // Adicionando log para verificar o conteúdo do ticketText

    // Verifica se o ticketText é uma string válida e não está vazio
    if (typeof ticketText !== 'string' || ticketText.trim() === '') {
      return res
        .status(400)
        .json({ error: 'O texto do ticket está vazio ou não é válido.' });
    }

    // Histórico de interações para passar para a IA
    let historicoInteracoes = [{ pergunta: ticketText, resposta: '' }];
    let tentativas = 0;
    const maxTentativas = 2; // Máximo de tentativas para a IA tentar resolver o ticket

    let respostaIA = '';

    while (tentativas < maxTentativas) {
      // Envia o histórico de interações para a IA gerar uma resposta
      respostaIA = await gerarRespostaIA(historicoInteracoes);

      if (!respostaIA) {
        console.error('Erro: A resposta da IA não foi gerada corretamente.');
        return res.status(500).json({ error: 'Erro ao gerar resposta com IA' });
      }

      // Adiciona a resposta gerada da IA ao histórico
      historicoInteracoes.push({ pergunta: ticketText, resposta: respostaIA });

      // Envia a resposta gerada para o ticket
      const respostaEnviada = await responderTicket(ticketId, respostaIA);

      if (!respostaEnviada) {
        console.error(
          'Erro: Falha ao enviar resposta para o ticket ID:',
          ticketId,
        );
        return res
          .status(500)
          .json({ error: 'Falha ao enviar resposta para o ticket' });
      }

      // Verifica se a IA respondeu de forma satisfatória (ex: "resolvido" no texto)
      if (respostaIA.toLowerCase().includes('resolvido')) {
        console.log(
          `Resposta IA enviada com sucesso para o ticket ID ${ticketId}: ${respostaIA}`,
        );
        break;
      }

      tentativas += 1; // Incrementa as tentativas
    }

    // Se o problema não foi resolvido após 3 tentativas, responde de forma final
    if (tentativas === maxTentativas) {
      respostaIA =
        'Este problema não foi resolvido após 3 tentativas de nossa IA. Por favor, assuma o atendimento diretamente.';
      const respostaEnviada = await responderTicket(ticketId, respostaIA);

      if (!respostaEnviada) {
        console.error(
          'Erro: Não foi possível enviar resposta final para o ticket ID:',
          ticketId,
        );
        return res
          .status(500)
          .json({ error: 'Falha ao enviar resposta final para o ticket' });
      }
    }

    // Registra o status do ticket e a resposta final no Google Sheets
    await registrarNoGoogleSheets(
      ticketId,
      tentativas < maxTentativas ? 'Resolvido' : 'Não resolvido',
      respostaIA,
    );

    return res.status(200).json({
      message: 'Ticket processado com sucesso!',
      resposta: respostaIA,
    });
  } catch (error) {
    // Se ocorrer algum erro no processamento, loga o erro
    console.error('Erro ao processar o ticket:', error);
    return res.status(500).json({ error: 'Erro ao processar o ticket' });
  }
};

module.exports = { processarTicket };
