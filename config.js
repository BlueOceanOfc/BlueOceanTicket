require('dotenv').config();

function validarVariaveisObrigatorias(variaveis) {
  for (const variavel of variaveis) {
    if (!process.env[variavel]) {
      throw new Error(`❌ Variável de ambiente ausente: ${variavel}`);
    }
  }
}

// Lista de variáveis obrigatórias
validarVariaveisObrigatorias([
  'OPENAI_API_KEY',
  'TICKET_API_BASE_URL',
  'API_KEY',
  'SHEET_ID',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_CLIENT_EMAIL',
]);

module.exports = {
  openAIAPIKey: process.env.OPENAI_API_KEY,
  ticketAPIBaseURL: process.env.TICKET_API_BASE_URL,
  API_KEY: process.env.API_KEY,
  SHEET_ID: process.env.SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT: {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
  },
};
