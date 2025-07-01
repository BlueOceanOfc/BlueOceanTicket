const axios = require('axios');

// Definir a URL da API e a chave
const API_KEY =
  'qp8r55uij9k07ya2st1mf0d90h70t00f0yaytrg7zqq80oin53eznuh44q7x01h1';
const BASE_URL = 'https://smmexcellent.com/adminapi/v2/orders'; // URL base de Orders

// Função para pegar a lista de tickets
async function getTickets() {
  try {
    const response = await axios.get(BASE_URL, {
      headers: {
        'X-Api-Key': API_KEY, // Envia a chave da API no cabeçalho
      },
      params: {
        limit: 1, // Limite de 1 ticket para teste, pode ajustar conforme necessário
        offset: 0, // Offset inicial para a paginação
      },
    });

    // Exibe os dados retornados no console
    console.log('Resposta da API:', response.data);

    if (response.data && response.data.data.list.length > 0) {
      const ticket = response.data.data.list[0];
      console.log(`Ticket ID: ${ticket.id}`);
      console.log(`Status: ${ticket.status}`);
      console.log(`Link: ${ticket.link}`);
      console.log(`Criado em: ${ticket.created}`);
    } else {
      console.log('Nenhum ticket encontrado.');
    }
  } catch (error) {
    console.error('Erro ao fazer a requisição:', error.message);
  }
}

// Chama a função para obter os tickets
getTickets();
