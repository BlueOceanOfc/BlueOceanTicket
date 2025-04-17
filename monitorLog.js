const fs = require('fs');
const path = require('path');
//const { gerarRespostaIA } = require('./services/openAIService'); // Importando a função de IA

// Caminho para o arquivo de log
const logFilePath = './messages_logs/ticket_messages_log.txt';

fs.watchFile(logFilePath, { interval: 10000 }, (curr, prev) => {
  if (curr.mtime !== prev.mtime) {
    // Verifica se o arquivo foi alterado
    console.log('O arquivo de log foi alterado!');

    // Lê o conteúdo do arquivo
    const content = fs.readFileSync(logFilePath, 'utf-8');
    console.log('Conteúdo atual do arquivo de log:', content);

    // Verifica se o conteúdo do arquivo não está vazio
    if (content.trim() !== '') {
      // Aqui você pode processar o conteúdo e enviar para a IA
      gerarRespostaIA(content)
        .then((respostaIA) => {
          console.log('Resposta gerada pela IA: ', respostaIA);
          // Agora, se necessário, você pode fazer algo com a resposta
        })
        .catch((err) => {
          console.error('Erro ao processar a IA:', err);
        });
    } else {
      console.log('O arquivo de log não contém novas mensagens.');
    }
  }
});

console.log('Monitorando o arquivo de log...');
