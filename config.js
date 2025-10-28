import dotenv from 'dotenv';
dotenv.config();

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

// Variáveis obrigatórias para OAuth2 web (client_secret.json)
validarVariaveisObrigatorias([
  'GOOGLE_WEB_CLIENT_ID',
  'GOOGLE_WEB_CLIENT_SECRET',
  'GOOGLE_WEB_AUTH_URI',
  'GOOGLE_WEB_TOKEN_URI',
  'GOOGLE_WEB_AUTH_PROVIDER_X509_CERT_URL',
]);

export default {
  openAIAPIKey: process.env.OPENAI_API_KEY,
  ticketAPIBaseURL: process.env.TICKET_API_BASE_URL,
  API_KEY: process.env.API_KEY,
  SHEET_ID: process.env.SHEET_ID,
  GOOGLE_SERVICE_ACCOUNT: {
    type: process.env.GOOGLE_TYPE,
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, '\n'),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: process.env.GOOGLE_AUTH_URI,
    token_uri: process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT,
    client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
  },
  GOOGLE_OAUTH2_WEB: {
    client_id: process.env.GOOGLE_WEB_CLIENT_ID,
    project_id: process.env.GOOGLE_WEB_PROJECT_ID,
    client_secret: process.env.GOOGLE_WEB_CLIENT_SECRET,
    auth_uri: process.env.GOOGLE_WEB_AUTH_URI,
    token_uri: process.env.GOOGLE_WEB_TOKEN_URI,
    auth_provider_x509_cert_url:
      process.env.GOOGLE_WEB_AUTH_PROVIDER_X509_CERT_URL,
    redirect_uris: process.env.GOOGLE_WEB_REDIRECT_URIS
      ? process.env.GOOGLE_WEB_REDIRECT_URIS.split(',')
      : ['http://localhost'],
  },
};
