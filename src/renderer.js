window.addEventListener('DOMContentLoaded', () => {
  // Seleção de elementos da interface dentro do evento 'DOMContentLoaded'
  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');
  const statusIndicator = document.getElementById('statusIndicator');
  const terminalContainer = document.getElementById('terminal-container');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const darkModeToggle = document.getElementById('darkModeToggle');
  const emojiSpan =
    document.querySelector('.emoji-light') ||
    document.querySelector('.emoji-dark');

  let terminal;

  // Inicializa terminal com tema escuro padrão (como VS Code)
  function initTerminal() {
    terminal = new Terminal({
      fontFamily: 'Fira Code, monospace',
      fontSize: 14,
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selection: '#264f78',
      },
      scrollback: 100,
      tabStopWidth: 4,
    });

    terminal.open(terminalContainer);

    terminal.onData(() => {
      terminal.scrollToBottom();
    });
  }

  // Atualização do terminal via IPC
  if (window?.electron?.onTerminalUpdate) {
    window.electron.onTerminalUpdate((_event, output) => {
      const linhas = output.toString().split('\n');
      linhas.forEach((linha) => {
        if (linha.trim() !== '') {
          terminal.writeln(linha);
        }
      });

      terminal.scrollToBottom();
    });
  }

  // Atualização de status via main process
  if (window?.electron?.onStatusUpdate) {
    window.electron.onStatusUpdate((_event, status) => {
      if (!statusIndicator) return;

      if (status.toLowerCase().includes('iniciada')) {
        statusIndicator.textContent = 'Status: Automação Iniciada';
        statusIndicator.classList.remove('status-stopped');
        statusIndicator.classList.add('status-running');
      } else {
        statusIndicator.textContent = 'Status: Automação Parada';
        statusIndicator.classList.remove('status-running');
        statusIndicator.classList.add('status-stopped');
      }

      if (status.includes('Parada')) {
        toggleButtons(false);
      }
    });
  }

  // === Alterna botões ===
  function toggleButtons(isRunning) {
    if (startButton) {
      startButton.disabled = isRunning;
    }
    if (stopButton) {
      stopButton.disabled = !isRunning;
    }

    if (loadingIndicator) {
      loadingIndicator.style.display = isRunning ? 'block' : 'none';
    }

    if (startButton) {
      if (isRunning) {
        startButton.classList.add('loading');
      } else {
        startButton.classList.remove('loading');
      }
    }
  }

  // === Verifique se os botões existem antes de adicionar os event listeners ===
  if (startButton) {
    startButton.addEventListener('click', () => {
      window.electron.startAutomation();
      toggleButtons(true);
    });
  }

  if (stopButton) {
    stopButton.addEventListener('click', () => {
      window.electron.stopAutomation();
      toggleButtons(false);
    });
  }

  // Aplica tema salvo
  const isDark = localStorage.getItem('darkMode') === 'true';
  document.body.classList.toggle('dark-mode', isDark);
  if (darkModeToggle) darkModeToggle.checked = isDark;
  if (emojiSpan) emojiSpan.textContent = isDark ? '🌙' : '☀️';

  // Inicializa o terminal
  initTerminal();

  // === Alterna modo escuro ===
  if (darkModeToggle) {
    darkModeToggle.addEventListener('change', () => {
      const isChecked = darkModeToggle.checked;
      document.body.classList.toggle('dark-mode', isChecked);
      localStorage.setItem('darkMode', isChecked);
      if (emojiSpan) emojiSpan.textContent = isChecked ? '🌙' : '☀️';
    });
  }
});
