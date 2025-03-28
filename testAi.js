const express = require('express');
const bodyParser = require('body-parser');
const { detectLanguage } = require('./iaSolicitacao'); // Importe a função de detecção de idioma
const {
  verificarTipoDeSolicitacao,
  gerarRespostaFinal,
} = require('./iaSolicitacao'); // Importe as funções necessárias para verificação e resposta
const logger = require('./logger'); // Verifique se o caminho está correto para o arquivo logger.js

const app = express();
const port = 3000;

// Configuração para ler o corpo da requisição
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Armazenar as mensagens e idiomas detectados para análise posterior
let mensagensEIdiomas = [];

// Página de teste
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <style>
        body {
          font-family: Arial, sans-serif;
          background-color: #f4f7f6;
          margin: 0;
          padding: 0;
        }
        h1 {
          text-align: center;
          color: #333;
        }
        form {
          width: 50%;
          margin: 0 auto;
          padding: 20px;
          background-color: #fff;
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
        }
        textarea {
          width: 100%;
          height: 150px;
          padding: 10px;
          margin: 10px 0;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 16px;
        }
        button {
          background-color: #007BFF;
          color: white;
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          font-size: 16px;
          cursor: pointer;
        }
        button:hover {
          background-color: #0056b3;
        }
        .result {
          margin-top: 20px;
          padding: 15px;
          background-color: #e9f7fd;
          border-radius: 4px;
          border: 1px solid #b3e0ff;
        }
        .back-button {
          display: block;
          width: 100%;
          padding: 10px;
          margin-top: 15px;
          background-color: #28a745;
          color: white;
          text-align: center;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .back-button:hover {
          background-color: #218838;
        }
      </style>
    </head>
    <body>
      <h1>Teste de Detecção de Idioma</h1>
      <form method="POST" action="/test">
        <textarea name="text" placeholder="Digite o texto aqui..."></textarea><br>
        <button type="submit">Detectar Idioma</button>
      </form>
      
      <h2>Histórico de Mensagens</h2>
      <div id="historico">
        ${mensagensEIdiomas
          .map(
            (item) =>
              `<div class="result">
        <p><strong>Texto:</strong> ${item.texto}</p>
        <p><strong>Idioma Detectado:</strong> ${item.idioma}</p>
      </div>`,
          )
          .join('')}

      </div>
    </body>
    </html>
  `);
});

// Endpoint para testar o idioma e gerar a resposta
app.post('/test', async (req, res) => {
  const text = req.body.text; // Texto que foi enviado pelo formulário

  if (!text) {
    return res.send('Por favor, forneça um texto para detectar o idioma.');
  }

  // Chama a função detectLanguage para detectar o idioma
  const idiomaDetectado = await detectLanguage([{ message: text }]);
  logger.info(`Idioma detectado: ${idiomaDetectado}`); // Log para verificar

  // Identificando o tipo de solicitação
  const { tipoSolicitacao, orderId } = await verificarTipoDeSolicitacao([
    { message: text },
  ]);
  logger.info(`Tipo de solicitação identificado: ${tipoSolicitacao}`);

  // Gerando a resposta final com base no tipo de solicitação e no idioma detectado
  const orderData = {
    orderId,
    user: 'marceloblueocean', // Exemplo de nome de usuário
    status: 'canceled', // Exemplo de status
    // Adicione outras informações do pedido conforme necessário
  };
  const respostaFinal = await gerarRespostaFinal(
    15,
    tipoSolicitacao,
    orderId,
    orderData,
    idiomaDetectado,
  );

  // Armazenar a mensagem e o idioma detectado para histórico
  mensagensEIdiomas.push({ texto: text, idioma: idiomaDetectado });

  // Exibe a resposta gerada para o cliente no histórico
  res.send(`
    <h2>Resposta Gerada:</h2>
    <div class="result">
      <p><strong>Texto:</strong> ${text}</p>
      <p><strong>Idioma Detectado:</strong> ${idiomaDetectado}</p>
      <p><strong>Resposta Gerada:</strong> ${respostaFinal}</p>
    </div>
    <button class="back-button" onclick="window.history.back()">Voltar</button>
  `);
});

// Iniciar o servidor
app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
