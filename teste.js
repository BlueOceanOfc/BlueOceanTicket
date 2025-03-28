const axios = require('axios');
const config = require('./config');  // Arquivo de configuração

async function buscarTicket(ticketId) {
    try {
        const resposta = await axios.get(`${config.ticketAPIBaseURL}/tickets/${ticketId}`, {
            headers: { 'X-Api-Key': config.API_KEY }
        });
        
        // Exibe a resposta crua da API (sem qualquer tratamento)
        console.log('Resposta crua da API:', JSON.stringify(resposta.data, null, 2));
        
        return resposta.data.data; // Retorna os detalhes do ticket
    } catch (error) {
        console.error('Erro ao buscar ticket:', error);
        return null;
    }
}

async function processarTicket(ticketId) {
    const ticket = await buscarTicket(ticketId);

    if (!ticket) {
        console.log(`Ticket com ID ${ticketId} não encontrado.`);
        return;
    }

    // Exibe todas as mensagens (incluindo quem as enviou)
    const mensagens = ticket.messages;
    console.log("Mensagens brutas do ticket:");
    console.log(mensagens);

    // Criação de um array com as mensagens intercaladas corretamente, incluindo quem enviou
    const mensagensComAutor = [];

    // Processando as mensagens
    mensagens.forEach(msg => {
        mensagensComAutor.push({
            role: msg.is_staff ? 'system' : 'user',  // 'system' para suporte, 'user' para cliente
            sender: msg.sender_name,  // Nome do remetente (cliente ou suporte)
            content: msg.message.replace(/<\/?[^>]+(>|$)/g, '').trim() // Remover tags HTML
        });
    });

    // Exibindo as mensagens intercaladas com a identidade correta
    console.log('Mensagens intercaladas (com identificação correta):');
    console.log(mensagensComAutor);

    // Aqui você pode passar essas mensagens para a IA, por exemplo
}

// Testando com um ticket específico
processarTicket(13); // Troque "13" pelo ID do ticket desejado
