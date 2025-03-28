const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');
require('dotenv').config(); // Certifique-se de carregar as variáveis de ambiente
const logger = require('../logger'); // Sistema de logs

// Pega o ID da planilha do .env
const SHEET_ID = process.env.SHEET_ID;

// Autenticação com a conta de serviço
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'), // Certificando-se que as quebras de linha são substituídas
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Conectar ao Google Sheets
async function conectarSheets() {
  try {
    const doc = new GoogleSpreadsheet(SHEET_ID, auth);
    await doc.loadInfo(); // Carrega os dados da planilha
    return doc;
  } catch (erro) {
    throw erro;
  }
}

// Função para registrar os dados no Google Sheets
async function registrarNoGoogleSheets(dados) {
  try {
    const doc = await conectarSheets(); // Conecta à planilha
    const sheet = doc.sheetsByIndex[0]; // Pega a primeira aba da planilha

    // Verificando os dados antes de enviar para o Google Sheets

    // Adiciona a linha com os dados corretamente formatados para o Google Sheets
    await sheet.addRow(dados);
  } catch (erro) {}
}

module.exports = {
  registrarNoGoogleSheets, // Função para registrar dados reais
  conectarSheets,
};
