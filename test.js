import axios from 'axios';

// Definir a URL da API e a chave
const API_KEY =
  'qp8r55uij9k07ya2st1mf0d90h70t00f0yaytrg7zqq80oin53eznuh44q7x01h1';
const BASE_URL = 'https://smmexcellent.com/adminapi/v2/tickets'; // URL base de tickets

// Função para pegar a lista de tickets
async function getTickets() {
  try {
    const response = await axios.get(BASE_URL, {
      headers: {
        'X-Api-Key': API_KEY, // Envia a chave da API no cabeçalho
      },
      params: {
        limit: 3, // Limite de 1 ticket para teste, pode ajustar conforme necessário
        offset: 1, // Offset inicial para a paginação
      },
    });

    // Exibe os dados retornados no console
    console.log('Resposta da API:', response.data);

    if (response.data && response.data.data.list.length > 0) {
      const ticket = response.data.data.list[0];

      // Mude esta linha:
      // console.log('Resposta da API:', response.data);
      // Para esta, para ver os detalhes completos:
      console.log('--- Detalhes do Primeiro Ticket ---');
      console.dir(ticket, { depth: null }); // Use depth: null para ver aninhamento completo
      console.log('----------------------------------');

      console.log(`Ticket ID: ${ticket.id}`);
      console.log(`Status: ${ticket.status}`);
      console.log(`Criado em: ${ticket.created}`);
      // Remova a linha do 'Link' até ter certeza da propriedade
    } else {
      console.log('Nenhum ticket encontrado.');
    }
  } catch (error) {
    console.error('Erro ao fazer a requisição:', error.message);
  }
}

// Chama a função para obter os tickets
getTickets();
