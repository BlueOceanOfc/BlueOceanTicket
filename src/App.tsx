import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  Terminal as TerminalIcon,
  Moon,
  Sun,
  Trash2,
  Activity,
  Zap,
  Code2,
} from 'lucide-react';

// Adiciona tipagem global para o objeto electron
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const electron = window.electron;

function App() {
  const [isRunning, setIsRunning] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [showSplash, setShowSplash] = useState(true);
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef<boolean>(true);
  const CONTROL_URL =
    import.meta.env.VITE_CONTROL_URL || 'http://localhost:3000';
  const [logsSummary, setLogsSummary] = useState<null | {
    totalFiles: number;
    totalSizeBytes: number;
    folders: Array<{ folder: string; files: number; sizeBytes: number }>;
  }>(null);
  const [showLogsCard, setShowLogsCard] = useState(false);
  type ArchiveItem = { name: string; bytes: number };
  const [archives, setArchives] = useState<ArchiveItem[]>([]);
  const [openArchives, setOpenArchives] = useState<Record<string, boolean>>({});
  const [showArchivesPanel, setShowArchivesPanel] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) setIsDarkMode(saved === 'true');
  }, []);

  useEffect(() => {
    localStorage.setItem('darkMode', String(isDarkMode));
  }, [isDarkMode]);

  useEffect(() => {
    if (terminalRef.current && shouldAutoScrollRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  // Track user scroll to avoid forcing auto-scroll when user scrolled up
  useEffect(() => {
    const el = terminalRef.current;
    if (!el) return undefined;
    const onScroll = () => {
      const threshold = 20; // px tolerance
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
      shouldAutoScrollRef.current = atBottom;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    // initialize
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  const handleStart = async () => {
    console.log('Botão iniciar clicado'); // debug
    setIsRunning(true);
    addTerminalLine('✓ Sistema inicializado com sucesso', 'success');
    addTerminalLine('→ Conectando ao servidor...', 'info');
    // Chama o backend para iniciar automação
    if (electron && electron.startAutomation) {
      electron.startAutomation();
    } else {
      try {
        const r = await fetch(`${CONTROL_URL}/ctrl/start`, { method: 'POST' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        addTerminalLine('✓ Comando START enviado ao backend (HTTP)', 'success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addTerminalLine(`Erro ao enviar START via HTTP: ${msg}`, 'error');
      }
    }
    setTimeout(() => {
      addTerminalLine('✓ Conexão estabelecida', 'success');
      addTerminalLine('→ Automação iniciada', 'info');
      addTerminalLine('⚙ Processando tarefas...', 'processing');
    }, 1000);
  };

  const handleStop = async () => {
    setIsRunning(false);
    addTerminalLine('■ Automação interrompida pelo usuário', 'warning');
    addTerminalLine('→ Finalizando processos...', 'info');
    // Chama o backend para parar automação
    if (electron && electron.stopAutomation) {
      electron.stopAutomation();
    } else {
      try {
        const r = await fetch(`${CONTROL_URL}/ctrl/stop`, { method: 'POST' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        addTerminalLine('✓ Comando STOP enviado ao backend (HTTP)', 'success');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addTerminalLine(`Erro ao enviar STOP via HTTP: ${msg}`, 'error');
      }
    }
    setTimeout(() => {
      addTerminalLine('✓ Sistema parado com segurança', 'success');
    }, 500);
  };

  const handleClearTerminal = () => {
    setTerminalOutput([]);
    // after clearing, resume auto-scroll
    shouldAutoScrollRef.current = true;
    addTerminalLine('Terminal limpo', 'info');
  };

  const fetchLogsSummary = async () => {
    try {
      const r = await fetch(`${CONTROL_URL}/ctrl/logs-summary`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setLogsSummary(j);
      addTerminalLine('✓ Resumo de logs carregado', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(`Erro ao obter resumo de logs: ${msg}`, 'error');
    }
  };

  const fetchArchiveList = async () => {
    try {
      const r = await fetch(`${CONTROL_URL}/ctrl/archive/list`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const arr = (j.archives || []) as unknown as ArchiveItem[];
      setArchives(arr.map((a) => ({ name: a.name, bytes: a.bytes })));
      addTerminalLine('✓ Lista de arquivos arquivados carregada', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(
        `Erro ao obter lista de arquivos arquivados: ${msg}`,
        'error',
      );
    }
  };

  const downloadArchive = async (name: string) => {
    try {
      // Trigger browser download by navigating to the download endpoint
      const url = `${CONTROL_URL}/ctrl/archive/download?name=${encodeURIComponent(
        name,
      )}`;
      // open in new tab to let the browser handle the download
      window.open(url, '_blank');
      addTerminalLine(`→ Iniciando download de ${name}...`, 'info');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(`Erro ao iniciar download: ${msg}`, 'error');
    }
  };

  const archiveFolder = async (folderName: string) => {
    try {
      addTerminalLine(`→ Compactando pasta ${folderName}...`, 'info');
      const r = await fetch(`${CONTROL_URL}/ctrl/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderName, removeOriginal: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      addTerminalLine(
        `✓ Arquivo criado: ${j.path} (${j.bytes} bytes)`,
        'success',
      );
      // refresh summary
      fetchLogsSummary();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addTerminalLine(`Erro ao compactar pasta: ${msg}`, 'error');
    }
  };

  const addTerminalLine = (
    text: string,
    type: 'info' | 'success' | 'error' | 'warning' | 'processing' = 'info',
  ) => {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const raw = `[${timestamp}] ${type.toUpperCase()} ${text}`;
    const MAX_LINES = 2000; // keep last N lines in memory
    const MAX_LINE_LENGTH = 2000; // truncate very long single lines
    const trimmed =
      raw.length > MAX_LINE_LENGTH ? raw.slice(0, MAX_LINE_LENGTH) + '…' : raw;
    setTerminalOutput((prev) => {
      const next = [...prev, trimmed];
      if (next.length > MAX_LINES) {
        // keep the last MAX_LINES entries
        return next.slice(next.length - MAX_LINES);
      }
      return next;
    });
  };

  useEffect(() => {
    const hasSeenSplash = sessionStorage.getItem('hasSeenSplash');
    if (hasSeenSplash) {
      setShowSplash(false);
    } else {
      const splashTimeout = setTimeout(() => {
        setShowSplash(false);
        sessionStorage.setItem('hasSeenSplash', 'true');
      }, 2500);
      return () => clearTimeout(splashTimeout);
    }

    addTerminalLine('Sistema pronto para iniciar', 'info');
  }, []);

  // Recebe atualizações do backend para o terminal
  useEffect(() => {
    if (electron && electron.onTerminalUpdate) {
      const normalizeIncoming = (raw: string) => {
        if (!raw) return '';
        // try parse JSON payloads like { line: '...' } or { message: '...' }
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj === 'object') {
            if (typeof obj.line === 'string') return obj.line;
            if (typeof obj.message === 'string') return obj.message;
            // If object has nested data.message or data.line
            if (obj.data && typeof obj.data === 'object') {
              if (typeof obj.data.line === 'string') return obj.data.line;
              if (typeof obj.data.message === 'string') return obj.data.message;
            }
          }
        } catch {
          // not JSON
        }
        // strip common wrapper like '"{\"line\":...}"'
        const m = String(raw).match(/\{\s*"line"\s*:\s*"([\s\S]+?)"\s*\}/);
        if (m && m[1]) return m[1];
        return String(raw);
      };

      const listener = (_event: unknown, message: string) => {
        const text = normalizeIncoming(String(message));
        setTerminalOutput((prev) => [...prev, text]);
      };
      electron.onTerminalUpdate(listener);
      return () => {
        // Não há método oficial para remover listeners no preload custom, mas pode ser implementado se necessário
      };
    }
  }, []);

  // If not running inside Electron, connect to backend control server via SSE for logs
  useEffect(() => {
    if (electron && electron.onTerminalUpdate) return;
    let evt: EventSource | null = null;
    try {
      evt = new EventSource(`${CONTROL_URL}/ctrl/logs`);
      const normalizeIncomingSse = (raw: string) => {
        if (!raw) return '';
        try {
          const obj = JSON.parse(raw);
          if (obj && typeof obj === 'object') {
            if (typeof obj.line === 'string') return obj.line;
            if (typeof obj.message === 'string') return obj.message;
            if (obj.data && typeof obj.data === 'object') {
              if (typeof obj.data.line === 'string') return obj.data.line;
              if (typeof obj.data.message === 'string') return obj.data.message;
            }
          }
        } catch {
          // not JSON
        }
        return String(raw);
      };

      evt.onmessage = (e) => {
        // event.data may already be a string; extract inner line if it's JSON
        const parsed = normalizeIncomingSse(String(e.data));
        setTerminalOutput((prev) => [...prev, parsed]);
      };
      evt.onerror = (e) => {
        setTerminalOutput((prev) => [...prev, `[SSE ERROR] ${String(e)}`]);
        // close on error
        if (evt) {
          try {
            evt.close();
          } catch (closeErr) {
            setTerminalOutput((prev) => [
              ...prev,
              `[SSE CLOSE ERROR] ${String(closeErr)}`,
            ]);
          }
        }
      };
    } catch (err) {
      setTerminalOutput((prev) => [...prev, `[SSE INIT ERROR] ${String(err)}`]);
    }
    return () => {
      if (evt) {
        try {
          evt.close();
        } catch {
          // nothing
        }
      }
    };
  }, [CONTROL_URL]);

  // Grouped view state for cycles (collapsed/expanded)
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>(
    {},
  );

  // Parse terminalOutput into groups (cycles) and standalone entries
  const parsedBlocks = (() => {
    const blocks: Array<{
      type: 'group' | 'line';
      header?: string;
      items?: string[];
      idx?: number;
    }> = [];
    let i = 0;
    while (i < terminalOutput.length) {
      const line = String(terminalOutput[i]).trim();
      const lower = line.toLowerCase();
      // header detection: ciclo iniciado
      if (
        /(ciclo de automa[cç][aã]o iniciado|--- \u{1F504} ciclo de automa[cç][aã]o iniciado ---)/u.test(
          lower,
        ) ||
        (/ciclo de automa/i.test(lower) && lower.includes('iniciado'))
      ) {
        // start a group
        const header = line;
        const items: string[] = [];
        i += 1;
        while (i < terminalOutput.length) {
          const l = String(terminalOutput[i]).trim();
          const ll = l.toLowerCase();
          items.push(l);
          i += 1;
          if (ll.includes('ciclo de automa') && ll.includes('finalizado')) {
            break;
          }
        }
        blocks.push({ type: 'group', header, items, idx: blocks.length });
        continue;
      }
      // otherwise, standalone line
      blocks.push({ type: 'line', header: line, idx: blocks.length });
      i += 1;
    }
    return blocks;
  })();

  function toggleGroup(i: number) {
    setExpandedGroups((prev) => ({ ...prev, [i]: !prev[i] }));
  }

  return (
    <>
      {showSplash && (
        <div className='fixed inset-0 z-[100] flex items-center justify-center bg-slate-950 splash-screen'>
          <div className='text-center space-y-6 splash-content'>
            <div className='relative inline-block'>
              <div className='absolute inset-0 blur-2xl bg-blue-500/30 rounded-full animate-pulse' />
              <div className='relative bg-gradient-to-br from-blue-500 to-blue-600 p-6 rounded-2xl shadow-2xl shadow-blue-500/50 animate-bounce-slow'>
                <Code2 className='w-16 h-16 text-white' strokeWidth={2.5} />
              </div>
            </div>
            <div className='space-y-2'>
              <h1 className='text-4xl font-bold text-white tracking-tight animate-fade-in'>
                SMMEX Automação
              </h1>
              <div
                className='flex items-center justify-center gap-2 text-blue-400 animate-fade-in'
                style={{ animationDelay: '0.3s' }}
              >
                <Zap className='w-4 h-4 animate-pulse' />
                <p className='text-sm font-medium'>Inicializando sistema...</p>
              </div>
            </div>
            <div
              className='flex gap-1.5 justify-center animate-fade-in'
              style={{ animationDelay: '0.5s' }}
            >
              <div
                className='w-2 h-2 bg-blue-500 rounded-full animate-bounce'
                style={{ animationDelay: '0s' }}
              />
              <div
                className='w-2 h-2 bg-blue-500 rounded-full animate-bounce'
                style={{ animationDelay: '0.2s' }}
              />
              <div
                className='w-2 h-2 bg-blue-500 rounded-full animate-bounce'
                style={{ animationDelay: '0.4s' }}
              />
            </div>
            <button
              onClick={() => setShowSplash(false)}
              className='mt-6 px-6 py-2 rounded-lg bg-blue-600 text-white font-semibold shadow hover:bg-blue-700 transition-all duration-200'
            >
              Pular
            </button>
          </div>
        </div>
      )}

      <div
        className={`min-h-screen transition-colors duration-300 relative ${
          isDarkMode
            ? 'bg-black text-slate-100'
            : 'bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900'
        }`}
      >
        {/* Animated background grid */}
        {isDarkMode && (
          <div className='fixed inset-0 overflow-hidden pointer-events-none'>
            <div className='absolute inset-0 bg-grid-pattern opacity-20' />
            <div className='absolute inset-0 bg-gradient-radial' />
          </div>
        )}

        {/* Floating particles effect */}
        <div className='fixed inset-0 overflow-hidden pointer-events-none'>
          <div className='particle particle-1' />
          <div className='particle particle-2' />
          <div className='particle particle-3' />
          <div className='particle particle-4' />
          <div className='particle particle-5' />
          <div className='particle particle-6' />
          <div className='particle particle-7' />
          <div className='particle particle-8' />
          {/* extra subtle sparkles */}
          <div className='particle particle-9' />
          <div className='particle particle-10' />
          <div className='particle particle-11' />
          <div className='particle particle-12' />
          <div className='particle particle-13' />
          <div className='particle particle-14' />
          <div className='particle particle-15' />
          <div className='particle particle-16' />

          {/* star trails (estelas) - subtle moving trails with alternating brightness */}
          <div className='star-trail star-trail-1' />
          <div className='star-trail star-trail-2 long' />
          <div className='star-trail star-trail-3' />
          <div className='star-trail star-trail-4' />
          <div className='star-trail star-trail-5' />
        </div>

        {/* Animated lines */}
        {isDarkMode && (
          <div className='fixed inset-0 overflow-hidden pointer-events-none'>
            <div className='neon-line neon-line-1' />
            <div className='neon-line neon-line-2' />
            <div className='neon-line neon-line-3' />
          </div>
        )}
        {/* Header */}
        <header
          className={`sticky top-0 z-50 backdrop-blur-md border-b transition-all duration-300 hover:shadow-lg ${
            isDarkMode
              ? 'bg-slate-950/80 border-slate-700/50 hover:border-slate-600/50'
              : 'bg-white/80 border-slate-200/50 hover:border-slate-300/50'
          }`}
        >
          <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
            <div className='flex items-center justify-between h-16'>
              <div className='flex items-center gap-3 animate-fade-in'>
                <div className='relative p-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/30 transition-all duration-300 hover:scale-110 hover:shadow-blue-500/50 group'>
                  <Activity className='w-6 h-6 text-white transition-transform duration-300 group-hover:rotate-180' />
                  <div className='absolute inset-0 rounded-lg bg-gradient-to-br from-blue-400 to-blue-500 opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-300' />
                </div>
                <div>
                  <h1 className='text-xl font-bold tracking-tight'>
                    SMMEX Automação
                  </h1>
                  <p
                    className={`text-xs ${
                      isDarkMode ? 'text-slate-400' : 'text-slate-600'
                    }`}
                  >
                    Sistema de Automação de Tickets
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsDarkMode(!isDarkMode)}
                className={`relative p-2.5 rounded-xl transition-all duration-300 hover:scale-110 hover:rotate-12 group ${
                  isDarkMode
                    ? 'bg-slate-800 hover:bg-slate-700 text-yellow-400'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
                aria-label='Alternar tema'
              >
                <div className='absolute inset-0 rounded-xl bg-gradient-to-br from-yellow-400/20 to-orange-400/20 opacity-0 group-hover:opacity-100 blur-xl transition-opacity duration-300' />
                <div className='relative transition-transform duration-300 group-hover:scale-110'>
                  {isDarkMode ? (
                    <Sun className='w-5 h-5' />
                  ) : (
                    <Moon className='w-5 h-5' />
                  )}
                </div>
              </button>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6'>
          {/* Status Card */}
          <div className='animate-slide-up' style={{ animationDelay: '0.1s' }}>
            <div
              className={`rounded-2xl p-6 shadow-xl transition-all duration-300 hover:shadow-2xl hover:scale-[1.01] hover:-translate-y-1 group neon-border ${
                isDarkMode
                  ? 'bg-slate-800/50 border border-slate-700/50'
                  : 'bg-white border border-slate-200'
              }`}
            >
              <div className='flex items-center justify-between flex-wrap gap-4'>
                <div className='flex items-center gap-4'>
                  <div
                    className={`relative p-3 rounded-xl transition-all duration-300 hover:scale-110 ${
                      isRunning
                        ? 'bg-green-500/10 text-green-500'
                        : isDarkMode
                        ? 'bg-slate-700 text-slate-400'
                        : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <TerminalIcon className='w-6 h-6 transition-transform duration-300 group-hover:scale-110' />
                    {isRunning && (
                      <span className='absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse' />
                    )}
                  </div>
                  <div>
                    <h2 className='text-lg font-semibold'>
                      Status da Automação
                    </h2>
                    <div className='flex items-center gap-2 mt-1'>
                      <div
                        className={`w-2 h-2 rounded-full ${
                          isRunning
                            ? 'bg-green-500 animate-pulse'
                            : 'bg-red-500'
                        }`}
                      />
                      <p
                        className={`text-sm font-medium ${
                          isRunning
                            ? 'text-green-500'
                            : isDarkMode
                            ? 'text-slate-400'
                            : 'text-slate-600'
                        }`}
                      >
                        {isRunning ? 'Em Execução' : 'Parado'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className='flex gap-3 z-10'>
                  <button
                    onClick={handleStart}
                    disabled={isRunning}
                    type='button'
                    tabIndex={0}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all duration-300 shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                      isRunning
                        ? isDarkMode
                          ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed opacity-60'
                          : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-60'
                        : 'bg-gradient-to-r from-green-500 to-green-600 text-white hover:from-green-600 hover:to-green-700 hover:scale-105 hover:shadow-green-500/30 active:scale-95'
                    }`}
                    aria-disabled={isRunning}
                  >
                    <Play className='w-5 h-5' />
                    <span className='hidden sm:inline'>Iniciar</span>
                  </button>

                  <button
                    onClick={handleStop}
                    disabled={!isRunning}
                    type='button'
                    tabIndex={0}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all duration-300 shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                      !isRunning
                        ? isDarkMode
                          ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700 hover:scale-105 hover:shadow-red-500/30 active:scale-95'
                    }`}
                    aria-disabled={!isRunning}
                  >
                    <Square className='w-5 h-5' />
                    <span className='hidden sm:inline'>Parar</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Terminal Card */}
          <div className='animate-slide-up' style={{ animationDelay: '0.2s' }}>
            <div
              className={`rounded-2xl shadow-xl overflow-hidden transition-all duration-300 hover:shadow-2xl hover:scale-[1.01] hover:-translate-y-1 neon-border-terminal ${
                isDarkMode
                  ? 'bg-slate-950/50 border border-slate-800/50'
                  : 'bg-slate-900 border border-slate-800'
              }`}
            >
              {/* Terminal Header */}
              <div className='flex items-center justify-between px-5 py-3 bg-slate-800/50 border-b border-slate-700/50'>
                <div className='flex items-center gap-3'>
                  <div className='flex gap-2'>
                    <div className='w-3 h-3 rounded-full bg-red-500/80' />
                    <div className='w-3 h-3 rounded-full bg-yellow-500/80' />
                    <div className='w-3 h-3 rounded-full bg-green-500/80' />
                  </div>
                  <span className='text-sm font-medium text-slate-300'>
                    Terminal
                  </span>
                </div>

                <button
                  onClick={handleClearTerminal}
                  className='flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-slate-100 hover:scale-105 active:scale-95 group'
                  aria-label='Limpar terminal'
                >
                  <Trash2 className='w-3.5 h-3.5 transition-transform duration-200 group-hover:rotate-12' />
                  <span className='hidden sm:inline'>Limpar</span>
                </button>
              </div>

              {/* Terminal Content */}
              <div
                ref={terminalRef}
                className='p-5 h-96 overflow-y-auto font-mono text-sm leading-relaxed custom-scrollbar'
              >
                {terminalOutput.length === 0 ? (
                  <div className='flex items-center justify-center h-full text-slate-500'>
                    <p>Aguardando comandos...</p>
                  </div>
                ) : (
                  // Render parsed blocks (groups & standalone)
                  parsedBlocks.map((blk, bidx) => {
                    if (blk.type === 'line') {
                      const text = blk.header ?? '';
                      const time = new Date().toLocaleTimeString('pt-BR');
                      return (
                        <div
                          key={`line-${bidx}`}
                          className='my-1 py-1 animate-fade-in text-slate-300'
                        >
                          <span className='text-xs text-slate-500 mr-2'>
                            {time}
                          </span>
                          <span>{text}</span>
                        </div>
                      );
                    }
                    // group
                    const gid = blk.idx ?? bidx;
                    const isExpanded = !!expandedGroups[gid];
                    // detect tickets and specifically "com novas mensagens"
                    const items = Array.isArray(blk.items)
                      ? blk.items.map((x) => String(x))
                      : [];
                    // detect explicit "com novas mensagens" (Portuguese) or "Iniciando processamento de X ticket" lines
                    const newMessagesCounts = items
                      .map((it) => {
                        const mNew = it.match(
                          /(\d+)\s*com\s*novas\s*mensagens/i,
                        );
                        if (mNew && mNew[1]) return parseInt(mNew[1], 10);
                        const mProcessing = it.match(
                          /Iniciando processamento de\s*(\d+)\s*ticket/i,
                        );
                        if (mProcessing && mProcessing[1])
                          return parseInt(mProcessing[1], 10);
                        const mUpdated = it.match(
                          /processing\s*(\d+)\s*ticket/i,
                        );
                        if (mUpdated && mUpdated[1])
                          return parseInt(mUpdated[1], 10);
                        return 0;
                      })
                      .reduce((a, b) => a + b, 0);
                    const hasNewMessages = newMessagesCounts > 0;
                    return (
                      <div
                        key={`group-${bidx}`}
                        className={`my-3 border rounded-lg overflow-hidden ${
                          hasNewMessages
                            ? 'border-green-600'
                            : 'border-slate-700'
                        }`}
                      >
                        <div
                          className={`flex items-center justify-between p-3 ${
                            hasNewMessages
                              ? 'bg-green-900/10'
                              : 'bg-slate-900/60'
                          }`}
                        >
                          <div>
                            <div
                              className={`text-sm ${
                                hasNewMessages
                                  ? 'text-green-300'
                                  : 'text-slate-400'
                              }`}
                            >
                              Ciclo de Automação
                            </div>
                            <div
                              className={`font-semibold mt-1 ${
                                hasNewMessages
                                  ? 'text-green-100'
                                  : 'text-slate-100'
                              }`}
                            >
                              {blk.header}
                            </div>
                          </div>
                          <div className='flex items-center gap-2'>
                            {hasNewMessages && (
                              <div className='px-2 py-1 rounded-md bg-green-600 text-xs text-white'>
                                Novas mensagens
                              </div>
                            )}
                            <button
                              onClick={() => toggleGroup(gid)}
                              className='px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200'
                            >
                              {isExpanded ? 'Ocultar' : 'Mostrar'}
                            </button>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className='p-3 bg-slate-950/40 space-y-1'>
                            {blk.items &&
                              blk.items.map((it, ii) => (
                                <div
                                  key={`g-${bidx}-it-${ii}`}
                                  className='text-sm text-slate-300'
                                >
                                  {it}
                                </div>
                              ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {isRunning && (
                  <div className='flex items-center gap-2 mt-2 text-blue-400 animate-pulse'>
                    <div className='w-2 h-2 rounded-full bg-blue-400' />
                    <span>Sistema em execução...</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Logs Summary - placed below terminal and collapsed by default (click title to toggle) */}
          <div
            className='animate-slide-up mt-4'
            style={{ animationDelay: '0.25s' }}
          >
            <div
              className={`rounded-2xl p-3 shadow transition-all ${
                isDarkMode
                  ? 'bg-slate-800/30 border border-slate-700/30'
                  : 'bg-white/90 border border-slate-200'
              }`}
            >
              <div
                className='flex items-center justify-between cursor-pointer'
                onClick={() => {
                  // toggle and when opening, refresh summary
                  setShowLogsCard((s) => {
                    const next = !s;
                    if (next) fetchLogsSummary();
                    return next;
                  });
                }}
              >
                <div>
                  <h3 className='text-sm font-semibold'>Logs (tickets)</h3>
                  <p className='text-xs text-slate-400'>
                    Clique aqui para abrir/fechar — gerencie e verifique o uso
                    de logs locais
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowArchivesPanel((s) => {
                        const next = !s;
                        if (next) fetchArchiveList();
                        return next;
                      });
                    }}
                    className='px-3 py-1 rounded-md bg-gradient-to-r from-indigo-600 to-indigo-700 text-white text-xs'
                  >
                    Arquivos arquivados
                  </button>
                  <div className='text-xs text-slate-400'>
                    {showLogsCard ? 'Fechar' : 'Abrir'}
                  </div>
                </div>
              </div>

              {showLogsCard && logsSummary && (
                <div className='mt-3 text-sm'>
                  <div className='text-xs text-slate-400'>
                    Arquivos de ticket: {logsSummary.totalFiles} — Tamanho
                    total:{' '}
                    {(logsSummary.totalSizeBytes / 1024 / 1024).toFixed(2)} MB
                  </div>
                  <div className='mt-2 space-y-1 max-h-40 overflow-auto'>
                    {logsSummary.folders.map((f) => {
                      const isOpen = !!openArchives[f.folder];
                      const archiveName = `${f.folder}.zip`;
                      const hasArchive = archives.find(
                        (a) => a.name === archiveName,
                      );
                      return (
                        <div
                          key={f.folder}
                          className='rounded-md bg-slate-900/20 overflow-hidden'
                        >
                          <div
                            className='flex items-center justify-between p-2 cursor-pointer'
                            onClick={() =>
                              setOpenArchives((prev) => ({
                                ...prev,
                                [f.folder]: !prev[f.folder],
                              }))
                            }
                          >
                            <div>
                              <div className='font-medium text-sm'>
                                {f.folder}
                              </div>
                              <div className='text-xs text-slate-400'>
                                {f.files} arquivos —{' '}
                                {(f.sizeBytes / 1024 / 1024).toFixed(2)} MB
                              </div>
                            </div>
                            <div className='flex items-center gap-2'>
                              <div className='text-xs text-slate-400'>
                                {isOpen ? 'Ocultar' : 'Detalhes'}
                              </div>
                            </div>
                          </div>
                          {isOpen && (
                            <div className='p-2 border-t border-slate-800/30 flex items-center justify-between'>
                              <div className='text-xs text-slate-300'>
                                Pasta:{' '}
                                <span className='font-mono'>{f.folder}</span>
                              </div>
                              <div className='flex items-center gap-2'>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    archiveFolder(f.folder);
                                  }}
                                  className='px-2 py-1 text-xs rounded bg-gradient-to-r from-green-500 to-green-600 text-white'
                                >
                                  Compactar & Remover originais
                                </button>
                                {hasArchive && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      downloadArchive(hasArchive.name);
                                    }}
                                    className='px-2 py-1 text-xs rounded bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                                  >
                                    Download .zip
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* archives listing (collapsed entries for each archive file) */}
              {showArchivesPanel && archives && archives.length > 0 && (
                <div className='mt-3 text-sm'>
                  <div className='text-xs text-slate-400 mb-2'>
                    Arquivos arquivados
                  </div>
                  <div className='space-y-1 max-h-40 overflow-auto'>
                    {archives.map((a) => {
                      const isOpen = !!openArchives[a.name];
                      return (
                        <div
                          key={a.name}
                          className='rounded-md bg-slate-900/20 overflow-hidden'
                        >
                          <div
                            className='flex items-center justify-between p-2 cursor-pointer'
                            onClick={() =>
                              setOpenArchives((prev) => ({
                                ...prev,
                                [a.name]: !prev[a.name],
                              }))
                            }
                          >
                            <div className='text-xs'>
                              <div className='font-medium'>{a.name}</div>
                              <div className='text-xs text-slate-400'>
                                {(a.bytes / 1024 / 1024).toFixed(2)} MB
                              </div>
                            </div>
                            <div className='text-xs text-slate-400'>
                              {isOpen ? 'Ocultar' : 'Abrir'}
                            </div>
                          </div>
                          {isOpen && (
                            <div className='p-2 border-t border-slate-800/30 flex items-center justify-between'>
                              <div className='text-xs text-slate-300'>
                                Local:{' '}
                                <span className='font-mono'>{a.name}</span>
                              </div>
                              <div className='flex items-center gap-2'>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    downloadArchive(a.name);
                                  }}
                                  className='px-2 py-1 text-xs rounded bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                                >
                                  Download
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

export default App;
