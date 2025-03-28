require('./services/axiosInterceptor');
const express = require('express');
const bodyParser = require('body-parser');
const { processarTicket } = require('./controllers/ticketController'); // Verifique se o caminho do controller está correto
const app = express();

// Middleware para garantir que o body seja interpretado como JSON
app.use(bodyParser.json());

// Rota para processar o ticket, recebendo o ticketId
app.post('/processar-ticket', processarTicket); // A função que processa o ticket deve ser chamada aqui

// Iniciar o servidor na porta desejada
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

module.exports = app; // Exporta a configuração do servidor
