const axios = require('axios');

// URL da API
const apiUrl = 'https://smmexcellent.com/adminapi/v2/orders/';

// Substitua com o ID do pedido que você deseja consultar
const orderId = 550039; // Exemplo, substitua pelo ID real
const apiKey =
  'qp8r55uij9k07ya2st1mf0d90h70t00f0yaytrg7zqq80oin53eznuh44q7x01h1'; // Substitua pela sua chave de API

// Configuração dos cabeçalhos
const headers = {
  'Content-Type': 'application/json',
  'X-Api-Key': apiKey,
};

// Função para fazer a requisição GET e obter as informações do pedido
async function getOrderDetails() {
  try {
    const response = await axios.get(`${apiUrl}${orderId}`, { headers });

    // Exibindo a resposta da API
    console.log('Detalhes do Pedido:', response.data);
  } catch (error) {
    // Em caso de erro
    console.error(
      'Erro ao obter os detalhes do pedido:',
      error.response ? error.response.data : error.message,
    );
  }
}

// Chama a função para obter os detalhes do pedido
getOrderDetails();
