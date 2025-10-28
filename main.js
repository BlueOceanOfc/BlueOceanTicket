import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fork } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// ESM helpers for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });

// We'll import ESM modules (logger/index) and provide safe fallbacks until they load
let iniciarAutomacao = () => {};
let pararAutomacao = () => {};
let logger = console;
try {
  const loggerMod = await import(new URL('./logger.js', import.meta.url).href);
  logger = loggerMod.logger || loggerMod.default || console;
} catch (e) {
  console.error('Falha ao importar logger.js dinamicamente:', e.message || e);
}
try {
  const indexMod = await import(new URL('./index.js', import.meta.url).href);
  iniciarAutomacao = indexMod.iniciarAutomacao || iniciarAutomacao;
  pararAutomacao = indexMod.pararAutomacao || pararAutomacao;
} catch (e) {
  console.error(
    'Falha ao importar index.js dinamicamente (fallback ok):',
    e.message || e,
  );
}

let mainWindow;
let backendProcess = null;
let backendStarted = false;
let isProcessing = false;

function createWindow() {
  if (mainWindow) return;
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  // Load Vite dev server when available (development) or fallback to index.html
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win
      .loadURL(devUrl)
      .catch((e) => logger.error(`Erro ao carregar URL dev: ${e.message}`));
  } else {
    win
      .loadFile(path.join(__dirname, 'index.html'))
      .catch((e) => logger.error(`Erro ao carregar index.html: ${e.message}`));
  }

  // Forward logs to renderer
  try {
    logger.setSender && logger.setSender(mainWindow);
  } catch (e) {
    console.error('Erro ao setar sender do logger', e);
  }

  win.on('closed', () => {
    mainWindow = null;
  });
}
// Helper: spawn backend process (keeps it paused until 'start' is sent)
function spawnBackendProcess() {
  if (backendProcess) return;
  const scriptPath = path.join(__dirname, 'index.js');
  logger.info(`Forking backend process: ${scriptPath}`);
  backendProcess = fork(scriptPath, [], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  // Stream stdout
  if (backendProcess.stdout) {
    backendProcess.stdout.on('data', (chunk) => {
      const text = String(chunk);
      text.split(/\r?\n/).forEach((ln) => {
        if (ln && ln.trim())
          mainWindow && mainWindow.webContents.send('update-terminal', ln);
      });
    });
  }
  // Stream stderr
  if (backendProcess.stderr) {
    backendProcess.stderr.on('data', (chunk) => {
      const text = String(chunk);
      text.split(/\r?\n/).forEach((ln) => {
        if (ln && ln.trim())
          mainWindow &&
            mainWindow.webContents.send('update-terminal', `[ERROR] ${ln}`);
      });
    });
  }

  backendProcess.on('exit', (code, signal) => {
    isProcessing = false;
    backendStarted = false;
    backendProcess = null;
    mainWindow &&
      mainWindow.webContents.send(
        'update-status',
        `Backend exited (code=${code} signal=${signal})`,
      );
    mainWindow &&
      mainWindow.webContents.send(
        'update-terminal',
        `Backend exited (code=${code} signal=${signal})`,
      );
  });

  // Forward any IPC messages from the child to the renderer for debugging
  try {
    backendProcess.on &&
      backendProcess.on('message', (msg) => {
        try {
          const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
          mainWindow &&
            mainWindow.webContents.send(
              'update-terminal',
              `[CHILD_MESSAGE] ${payload}`,
            );
          logger.info(`Mensagem recebida do backend child: ${payload}`);
        } catch (e) {
          logger.error(`Erro ao forwardar mensagem do child: ${e.message}`);
        }
      });
  } catch (e) {
    logger.warn(
      `Não foi possível registrar listener de mensagem do child: ${e.message}`,
    );
  }
}

// Start automation: send a message to the backend to begin processing
ipcMain.on('start-automation', () => {
  logger.info('IPC: start-automation recebido do renderer');
  if (!mainWindow) {
    logger.info('Janela principal não disponível para iniciar automação.');
    return;
  }
  if (backendStarted) {
    logger.info(
      'A automação já está em andamento no backend. Ignorando start.',
    );
    return;
  }
  if (!backendProcess) spawnBackendProcess();
  try {
    logger.info(
      `Enviando comando START ao backend; backendProcess? ${!!backendProcess} pid=${
        backendProcess?.pid
      } connected=${backendProcess?.connected}`,
    );
    backendProcess.send && backendProcess.send('start');
    backendStarted = true;
    isProcessing = true;
    mainWindow.webContents.send('update-status', 'Automação Iniciada');
  } catch (e) {
    logger.error(`Erro ao enviar start ao backend: ${e.message}`);
  }
});

// Stop automation
ipcMain.on('stop-automation', () => {
  if (!mainWindow) {
    logger.info('Janela principal não disponível para parar automação.');
    return;
  }
  if (!isProcessing && !backendStarted) {
    logger.info('Automação não está em andamento. Ignorando stop.');
    return;
  }

  // If backend is running, send stop signal via IPC
  if (backendProcess && backendStarted) {
    try {
      backendProcess.send && backendProcess.send('stop');
      backendStarted = false;
      isProcessing = false;
      mainWindow.webContents.send(
        'update-terminal',
        'Solicitado parada da automação no backend',
      );
      mainWindow.webContents.send('update-status', 'Automação Parada');
      return;
    } catch (e) {
      mainWindow.webContents.send(
        'update-terminal',
        `Erro ao enviar stop ao backend: ${e.message}`,
      );
    }
  }

  // Fallback: call in-process pararAutomacao
  try {
    pararAutomacao();
    mainWindow.webContents.send('update-status', 'Automação Parada');
    isProcessing = false;
  } catch (e) {
    logger.error(`Erro ao parar automação in-process: ${e.message}`);
  }
});

// Inicialização do app
app.whenReady().then(() => {
  createWindow();
  startAppMonitor(); // Inicia o monitoramento contínuo da aplicação
  // Spawn backend process in paused state so UI can start it via IPC
  try {
    spawnBackendProcess();
  } catch (e) {
    logger.error(`Erro ao spawnar backend em background: ${e.message}`);
  }
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
