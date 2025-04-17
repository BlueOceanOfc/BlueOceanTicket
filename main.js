const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { iniciarAutomacao, pararAutomacao } = require('./index');
const logger = require('./logger');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

let mainWindow;
let isProcessing = false; // Variável para controlar o estado da automação

// Função para criar a janela
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Garante que o mainWindow seja destruído ao fechar a janela
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Conecta logger ao frontend
  logger.setSender(mainWindow);
}

// Start automation
ipcMain.on('start-automation', () => {
  if (mainWindow && !isProcessing) {
    // Verifica se a janela existe e se não está processando
    iniciarAutomacao();
    mainWindow.webContents.send('update-status', 'Automação Iniciada');
    isProcessing = true; // Marca a automação como iniciada
  } else {
    logger.info(
      'A automação já está em andamento ou a janela não está disponível.',
    );
  }
});

// Stop automation
ipcMain.on('stop-automation', () => {
  if (mainWindow && isProcessing) {
    // Verifica se a janela existe e se está processando
    pararAutomacao();
    mainWindow.webContents.send('update-status', 'Automação Parada');
    isProcessing = false; // Marca a automação como parada
  } else {
    logger.info(
      'A automação não está em andamento ou a janela não está disponível.',
    );
  }
});

// Inicialização do app
app.whenReady().then(() => {
  createWindow();
  startAppMonitor(); // Inicia o monitoramento contínuo da aplicação
});

// Função para reiniciar a automação em caso de falha
function startAppMonitor() {
  // Monitorar continuamente a aplicação
  setInterval(() => {
    if (!mainWindow) {
      createWindow(); // Cria a janela novamente se ela for fechada
    }
  }, 60000); // Checa a cada 1 minuto
}

// Captura erros não tratados
process.on('uncaughtException', (error) => {
  logger.error(`Erro não tratado: ${error.message}`);
  logger.error(error.stack);
  // Reinicia a automação
  iniciarAutomacao();
});

// Captura promessas rejeitadas não tratadas
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Promessa não tratada: ${reason}`);
  // Reinicia a automação
  iniciarAutomacao();
});

// Lida com o fechamento de todas as janelas
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Para o caso de o app ser ativado novamente (como no macOS)
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
