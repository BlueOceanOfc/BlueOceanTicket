// Simula a resposta da API com mensagens
function buscarTicket(ticketId) {
  // Aqui, vamos retornar como se fosse a resposta real da API
  return [
    { sender: 'admin', message: '<div><b>Orders - Refill</b></div>' },
    {
      sender: 'client',
      message: '<div><b>Order ID</b>: 550039</div><hr>cancele',
    },
    { sender: 'client', message: 'quero cancelar' },
  ];
}

// Função para testar a extração da mensagem do cliente
async function testarMensagemDoCliente(ticketId) {
  const mensagensDoTicket = await buscarTicket(ticketId);

  // Garantir que a resposta seja um array
  const mensagensArray = Array.isArray(mensagensDoTicket)
    ? mensagensDoTicket
    : [];

  // Filtra mensagens enviadas pelo cliente
  const mensagensDoCliente = mensagensArray.filter(
    (mensagem) => mensagem.sender === 'client',
  );

  // Pega a primeira mensagem do cliente
  const primeiraMensagem =
    mensagensDoCliente?.[0]?.message || 'Mensagem não encontrada';

  console.log('📨 Primeira mensagem do cliente:', primeiraMensagem);
}

// Testando com ticketId 6389
testarMensagemDoCliente(6389);
