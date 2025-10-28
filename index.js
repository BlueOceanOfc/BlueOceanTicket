import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Configuração do .env (Mantida)
dotenv.config({
  path: path.resolve(path.dirname(new URL(import.meta.url).pathname), '.env'),
});

import './services/axiosInterceptor.js';
import { logger } from './logger.js';
import config from './config.js';
import * as sheetsService from './services/sheetsService.js';
import chalk from 'chalk';
import {
  responderTicket,
  buscarTicket,
  buscarStatusPedido,
  buscarStatusPedidosConcurrently,
  listarTickets,
  atualizarUltimaExecucao,
  obterUltimaExecucao,
  requestCancelOrders,
  requestResendOrders,
  requestAdminCancelOrders,
} from './services/apiService.js';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

// --- ATUALIZAÇÃO CHAVE: Importando as funções aprimoradas do novo parser ---
import {
  gerarRespostaFinal,
  verificarTipoDeSolicitacao,
  detectLanguage,
  gerarMensagemSolicitandoOrderId,
} from './services/iaSolicitacao.js';

import {
  parseRawMessage,
  separador,
  limparMensagem,
} from './services/utils.js'; // parser robusto + separador + limpeza

import { startTicketLog, appendTicketLog, finishTicketLog } from './logger.js';

logger.info(chalk.blue.bold('🚀 Backend inicializado: index.js rodando!'));

// --- Lightweight control server for Web UI (HTTP + SSE) ---
import express from 'express';
import cors from 'cors';
import archiver from 'archiver';

const CONTROL_PORT = process.env.CONTROL_PORT || 3000;
const controlApp = express();
controlApp.use(cors());
controlApp.use(express.json());

// SSE clients
let sseClients = [];
function broadcastToSseClients(line) {
  try {
    sseClients.forEach((c) => {
      try {
        c.res.write(`data: ${JSON.stringify({ line })}\n\n`);
      } catch (e) {
        // ignore per-client errors
      }
    });
  } catch (e) {
    // no-op
  }
}

// Wrap logger to also broadcast to SSE clients when present
try {
  const origInfo = logger.info.bind(logger);
  const origWarn = logger.warn.bind(logger);
  const origError = logger.error.bind(logger);
  logger.info = (...args) => {
    origInfo(...args);
    try {
      broadcastToSseClients(
        args
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' '),
      );
    } catch (e) {}
  };
  logger.warn = (...args) => {
    origWarn(...args);
    try {
      broadcastToSseClients(
        args
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' '),
      );
    } catch (e) {}
  };
  logger.error = (...args) => {
    origError(...args);
    try {
      broadcastToSseClients(
        args
          .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' '),
      );
    } catch (e) {}
  };
} catch (e) {
  // if logger is not available, ignore
}

controlApp.post('/ctrl/start', async (req, res) => {
  try {
    logger.info('HTTP /ctrl/start received — starting automation');
    // Start automation but don't crash if already running
    try {
      iniciarAutomacao();
    } catch (e) {
      logger.warn(`Falha ao iniciar automação via HTTP: ${e.message}`);
    }
    broadcastToSseClients('ACK: start');
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Erro em /ctrl/start: ${err.message}`);
    res.status(500).json({ ok: false, error: String(err.message) });
  }
});

controlApp.post('/ctrl/stop', async (req, res) => {
  try {
    logger.info('HTTP /ctrl/stop received — stopping automation');
    try {
      pararAutomacao();
    } catch (e) {
      logger.warn(`Falha ao parar automação via HTTP: ${e.message}`);
    }
    broadcastToSseClients('ACK: stop');
    res.json({ ok: true });
  } catch (err) {
    logger.error(`Erro em /ctrl/stop: ${err.message}`);
    res.status(500).json({ ok: false, error: String(err.message) });
  }
});

controlApp.get('/ctrl/logs', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');
  const client = { id: Date.now() + Math.random(), res };
  sseClients.push(client);
  logger.info('SSE client connected for /ctrl/logs');
  req.on('close', () => {
    sseClients = sseClients.filter((c) => c.id !== client.id);
    logger.info('SSE client disconnected from /ctrl/logs');
  });
});

// Return summary of ticket logs (counts, total size) and per-date-folder breakdown
controlApp.get('/ctrl/logs-summary', async (req, res) => {
  try {
    const ticketsRoot = path.join(process.cwd(), 'logs', 'tickets');
    let stat;
    try {
      stat = await fs.promises.stat(ticketsRoot);
    } catch (e) {
      return res.json({ totalFiles: 0, totalSizeBytes: 0, folders: [] });
    }
    if (!stat || !stat.isDirectory())
      return res.json({ totalFiles: 0, totalSizeBytes: 0, folders: [] });

    const dirents = await fs.promises.readdir(ticketsRoot, {
      withFileTypes: true,
    });
    const folders = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    const resultFolders = [];
    let totalFiles = 0;
    let totalSizeBytes = 0;
    for (const f of folders) {
      const folderPath = path.join(ticketsRoot, f);
      let files = [];
      try {
        const folderDirents = await fs.promises.readdir(folderPath, {
          withFileTypes: true,
        });
        files = folderDirents.filter((d) => d.isFile()).map((d) => d.name);
      } catch (e) {
        // ignore per-folder errors
        files = [];
      }
      let folderSize = 0;
      for (const fn of files) {
        try {
          const st = await fs.promises.stat(path.join(folderPath, fn));
          folderSize += st.size;
        } catch (e) {}
      }
      totalFiles += files.length;
      totalSizeBytes += folderSize;
      resultFolders.push({
        folder: f,
        files: files.length,
        sizeBytes: folderSize,
      });
    }
    // sort by date folder desc (if named like DD-MM-YYYY)
    resultFolders.sort((a, b) => (a.folder < b.folder ? 1 : -1));
    res.json({ totalFiles, totalSizeBytes, folders: resultFolders });
  } catch (err) {
    logger.error(`Erro em /ctrl/logs-summary: ${err.message}`);
    res.status(500).json({ ok: false, error: String(err.message) });
  }
});

// Archive (zip) a specific ticket-date folder into logs/archive/<folder>.zip without deleting originals.
controlApp.post('/ctrl/archive', async (req, res) => {
  try {
    const { folder, removeOriginal = true } = req.body || {};
    if (!folder || typeof folder !== 'string') {
      return res
        .status(400)
        .json({ ok: false, error: 'folder obrigatório (ex: 24-10-2025)' });
    }
    const srcDir = path.join(process.cwd(), 'logs', 'tickets', folder);
    try {
      const st = await fs.promises.stat(srcDir);
      if (!st.isDirectory())
        return res
          .status(404)
          .json({ ok: false, error: 'Pasta não encontrada' });
    } catch (e) {
      return res.status(404).json({ ok: false, error: 'Pasta não encontrada' });
    }
    const archiveRoot = path.join(process.cwd(), 'logs', 'archive');
    try {
      await fs.promises.mkdir(archiveRoot, { recursive: true });
    } catch (e) {
      // ignore
    }
    const destZip = path.join(archiveRoot, `${folder}.zip`);
    // If dest exists, append timestamp to avoid accidental overwrite
    let outPath = destZip;
    try {
      await fs.promises.access(outPath);
      const ts = Date.now();
      outPath = path.join(archiveRoot, `${folder}-${ts}.zip`);
    } catch (e) {
      // file doesn't exist -> fine
    }

    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', async () => {
      logger.info(
        `✅ Arquivo zip criado: ${outPath} (${archive.pointer()} bytes)`,
      );
      // If requested, remove the original uncompressed folder after successful archive
      if (removeOriginal) {
        try {
          if (fs.promises.rm) {
            await fs.promises.rm(srcDir, { recursive: true, force: true });
          } else if (fs.promises.rmdir) {
            await fs.promises.rmdir(srcDir, { recursive: true });
          }
          logger.info(`🗑️ Pasta original removida: ${srcDir}`);
        } catch (e) {
          logger.warn(
            `Falha ao remover pasta original ${srcDir}: ${e.message}`,
          );
        }
      }
      res.json({
        ok: true,
        path: outPath,
        bytes: archive.pointer(),
        removedOriginal: !!removeOriginal,
      });
    });
    archive.on('warning', (err) => {
      logger.warn(`Archiver warning: ${err.message}`);
    });
    archive.on('error', (err) => {
      logger.error(`Archiver error: ${err.message}`);
      try {
        res.status(500).json({ ok: false, error: String(err.message) });
      } catch (e) {}
    });
    archive.pipe(output);
    archive.directory(srcDir, false);
    await archive.finalize();
  } catch (err) {
    logger.error(`Erro em /ctrl/archive: ${err.message}`);
    try {
      res.status(500).json({ ok: false, error: String(err.message) });
    } catch (e) {}
  }
});

// List existing archive files
controlApp.get('/ctrl/archive/list', async (req, res) => {
  try {
    const archiveRoot = path.join(process.cwd(), 'logs', 'archive');
    try {
      const st = await fs.promises.stat(archiveRoot);
      if (!st.isDirectory()) return res.json({ archives: [] });
    } catch (e) {
      return res.json({ archives: [] });
    }
    const dirents = await fs.promises.readdir(archiveRoot, {
      withFileTypes: true,
    });
    const files = dirents
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((n) => n.toLowerCase().endsWith('.zip'));
    const archives = [];
    for (const fname of files) {
      const p = path.join(archiveRoot, fname);
      let size = 0;
      try {
        const st = await fs.promises.stat(p);
        size = st.size;
      } catch (e) {}
      archives.push({ name: fname, path: p, bytes: size });
    }
    res.json({ archives });
  } catch (err) {
    logger.error(`Erro em /ctrl/archive/list: ${err.message}`);
    res.status(500).json({ ok: false, error: String(err.message) });
  }
});

// Download a specific archive file by name (safe basename handling)
controlApp.get('/ctrl/archive/download', async (req, res) => {
  try {
    const { name } = req.query || {};
    if (!name || typeof name !== 'string')
      return res
        .status(400)
        .json({ ok: false, error: 'name query param obrigatório' });
    const archiveRoot = path.join(process.cwd(), 'logs', 'archive');
    const safeName = path.basename(name);
    const filePath = path.join(archiveRoot, safeName);
    try {
      const st = await fs.promises.stat(filePath);
      if (!st.isFile())
        return res
          .status(404)
          .json({ ok: false, error: 'Arquivo não encontrado' });
    } catch (e) {
      return res
        .status(404)
        .json({ ok: false, error: 'Arquivo não encontrado' });
    }
    res.download(filePath, safeName, (err) => {
      if (err)
        logger.warn(`Erro ao enviar download ${safeName}: ${err.message}`);
    });
  } catch (err) {
    logger.error(`Erro em /ctrl/archive/download: ${err.message}`);
    res.status(500).json({ ok: false, error: String(err.message) });
  }
});

controlApp.listen(CONTROL_PORT, () => {
  logger.info(`Control server listening on http://localhost:${CONTROL_PORT}`);
});

// --- Funções Auxiliares (Apenas logs ajustados) ---

// NOTE: Removed local wrapper `registrarNoGoogleSheets` to avoid duplication of
// responsibility. Use `sheetsService.registrarNoGoogleSheets(payload)` directly
// throughout the codebase. If an ambiguous record is to be logged, emit a
// `logger.warn` where appropriate before/after calling the sheets service.

async function registrarAvisoAmbiguo(ticketId, firstMessageRaw) {
  try {
    // Usa o parser para tentar extrair os IDs mesmo em caso ambíguo
    const { orderIds } = parseRawMessage(firstMessageRaw);
    const orderId = orderIds.length > 0 ? orderIds[0].id : 'Não informado';
    let orderData =
      orderId !== 'Não informado' ? await buscarStatusPedido(orderId) : {};

    const aviso = {
      orderId: orderData?.orderId || orderId, // ... (outros campos mantidos)
      lastMessage: 'Solicitação ambígua ou dois assuntos identificados',
    };
    const avisoPayload = {
      orderId: aviso.orderId ?? null,
      mensagemDoCliente: aviso.mensagemDoCliente ?? aviso.lastMessage ?? null,
      lastMessage: aviso.lastMessage ?? null,
      tipoSolicitacao: aviso.tipoSolicitacao ?? null,
      // keep original aviso fields
      ...aviso,
    };
    await sheetsService.registrarNoGoogleSheets(avisoPayload);
    logger.warn(`⚠️ Ticket ${ticketId}: Solicitação ambígua registrada.`);
  } catch (erro) {
    logger.error(`❌ Erro [Aviso Ambíguo]: ${erro.message}`);
  }
}

// --- Processamento Principal (Refatorado para o novo Parser) ---

async function processarTicket(ticketId, lastExecution) {
  try {
    logger.info(`\n--- ⚙️ Processando Ticket ID ${ticketId} ---`);
    let respostaEnviada = false;
    let respostaFinal = null;
    // acaoRealizadaForSheet: will contain a short summary of what action was taken
    // e.g. 'cancel_sent: ids=5; skipped=7,8' or '-' when no action was performed.
    let acaoRealizadaForSheet = '-';
    const seenOrderIdsNoTicket = new Set(); // Deduplicação por ticket
    const ticket = await buscarTicket(ticketId);
    if (!ticket) {
      logger.warn(`❌ Ticket ${ticketId} não encontrado. Ignorado.`);
      // Registrar no Sheets para auditoria quando o ticket não pode ser recuperado
      try {
        await sheetsService.registrarNoGoogleSheets({
          orderId: null,
          mensagemDoCliente: null,
          lastMessage: `Ticket ${ticketId} não encontrado ao buscar detalhes.`,
          tipoSolicitacao: null,
          acao_realizada: '-',
        });
      } catch (e) {
        logger.warn(
          `Falha ao registrar ticket não encontrado no Sheets: ${e.message}`,
        );
      }
      return;
    }

    const { messages } = ticket;
    const mensagemDeAtendente = messages.find((msg) => msg.is_staff);
    if (mensagemDeAtendente) {
      logger.info(`✅ Ticket ${ticketId} já respondido. Ignorado.`);
      return;
    }

    const primeiraMensagem = messages.find((msg) => !msg.is_staff);
    if (!primeiraMensagem) {
      logger.warn(`❌ Nenhuma mensagem do cliente em ${ticketId}. Ignorado.`);
      return;
    }

    // --- NOVO FLUXO: Uso do parseRawMessage para extração robusta ---
    const parsedMessage = parseRawMessage(primeiraMensagem.message);
    const mensagemCorpoLimpo = parsedMessage.body; // Conteúdo limpo para a IA
    const orderIdsExtraidos = (parsedMessage.orderIds || [])
      .filter((it) => it && it.id)
      .filter(
        (it) =>
          (it.confidence && it.confidence !== 'low') ||
          String(it.id).length >= 3,
      )
      .map((item) => String(item.id));

    // INICIAR LOG DE TICKET
    startTicketLog(
      ticketId,
      ticket.user?.username ?? ticket.user?.id ?? null,
      orderIdsExtraidos,
    );

    // Track per-order action to avoid duplicate writes and to write final rows after reply
    const perOrderActions = new Map(); // orderId -> action string
    let lastRawCancelResponse = null;
    let lastHttpStatusCancel = null;

    logger.info(`📝 Corpo da mensagem: "${mensagemCorpoLimpo}"`);
    if (!mensagemCorpoLimpo) {
      logger.warn(
        `❌ Mensagem do ticket ${ticketId} vazia após o parsing. Ignorado.`,
      );
      // Registrar no Sheets para auditoria: mensagem vazia após parsing
      try {
        await sheetsService.registrarNoGoogleSheets({
          orderId: null,
          user: ticket.user?.username ?? ticket.user?.id ?? null,
          mensagemDoCliente: primeiraMensagem.message ?? null,
          lastMessage: 'Mensagem vazia após parsing.',
          tipoSolicitacao: null,
          acao_realizada: '-',
        });
      } catch (e) {
        logger.warn(
          `Falha ao registrar mensagem vazia no Sheets: ${e.message}`,
        );
      }
      return;
    }

    // Checagem de tempo
    const lastUpdateTime = new Date(ticket.last_update_timestamp * 1000);
    if (lastUpdateTime <= new Date(lastExecution)) {
      logger.info(`⏳ Ticket ${ticketId} sem novas atualizações. Ignorado.`);
      return;
    }

    // --- Classificação e Fluxo de Decisão ---

    const idiomaDetectado = await detectLanguage([primeiraMensagem]);
    logger.info(`🌐 Idioma detectado: ${idiomaDetectado.toUpperCase()}`);

    logger.info(
      `🔑 Order IDs extraídos: ${orderIdsExtraidos.join(', ') || 'Nenhum'}`,
    );

    // Se o corpo for apenas dígitos, a intenção costuma estar no subject.
    // Ex.: cliente só envia "18584" — devemos interpretar o assunto (ex: "Orders - Refill").
    function mapSubjectToTipo(subj) {
      if (!subj || typeof subj !== 'string') return null;
      const s = subj.toLowerCase();
      if (
        s.includes('speed') ||
        s.includes('speed up') ||
        s.includes('acelera')
      )
        return 'Aceleração';
      if (s.includes('cancel') || s.includes('cancelamento'))
        return 'Cancelamento';
      if (
        s.includes('refill') ||
        s.includes('refil') ||
        s.includes('warrant') ||
        s.includes('garantia')
      )
        return 'Refil/Garantia';
      // fallback: if it contains 'order' or 'orders', consider it a generic 'Pedido'
      if (s.includes('order') || s.includes('orders')) return 'Pedido';
      return null;
    }

    let tipoSolicitacao;
    if (/^\d+$/.test(parsedMessage.body)) {
      // body contains only digits -> honor subject as intent when possible
      const mapped = mapSubjectToTipo(parsedMessage.subject);
      tipoSolicitacao = mapped || 'Pedido';
      logger.info(
        `🎯 Tipo inferido do subject (body só dígitos): ${tipoSolicitacao}`,
      );
    } else {
      // usual flow: ask the IA classifier
      const { tipoSolicitacao: tipoFromIA } = await verificarTipoDeSolicitacao(
        messages,
      );
      tipoSolicitacao = tipoFromIA;
      logger.info(`🎯 Tipo de solicitação classificado: ${tipoSolicitacao}`);
    }

    // Fluxo de Pagamento/Outro
    if (['Pagamento', 'Outro'].includes(tipoSolicitacao)) {
      logger.warn(`🚫 Ticket ${ticketId} ignorado (Tipo: ${tipoSolicitacao}).`);

      // Build a normalized payload to send to Sheets. Fill missing fields with null.
      const payload = {
        orderId:
          orderIdsExtraidos.length > 0 ? orderIdsExtraidos.join(', ') : null,
        externalId: null,
        user: ticket.user?.username ?? ticket.user?.id ?? null,
        link: null,
        startCount: null,
        quantity: null,
        serviceId: null,
        serviceName: null,
        status: null,
        remains: null,
        createdAt: ticket.created ?? null,
        provider: null,
        mensagemDoCliente:
          mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
        // parsed info
        subject: parsedMessage.subject ?? null,
        orderIdsParsed: parsedMessage.orderIds?.map((o) => o.id) ?? [],
        tipoSolicitacao: tipoSolicitacao,
        lastMessage:
          respostaFinal ?? `Ticket ignorado. Tipo: ${tipoSolicitacao}`,
      };

      await sheetsService.registrarNoGoogleSheets(payload); // Registrar como registro especial/ignorado
      logger.warn(`⚠️ Aviso ambíguo/registro especial adicionado ao Sheets.`);
      return;
    }

    // Fluxo de Pedido, mas sem IDs
    if (orderIdsExtraidos.length === 0) {
      logger.warn(
        `❓ Ticket ${ticketId}: Pedido sem Order ID. Solicitando ID...`,
      );
      if (!respostaEnviada) {
        const mensagemSolicitacao = await gerarMensagemSolicitandoOrderId(
          idiomaDetectado,
        );
        await responderTicket(ticketId, mensagemSolicitacao);
        respostaEnviada = true;
        await sheetsService.registrarNoGoogleSheets(
          {
            orderId: null,
            mensagemDoCliente:
              mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
            // prefer the exact message we just sent (mensagemSolicitacao) when available
            lastMessage:
              mensagemSolicitacao ??
              respostaFinal ??
              'Solicitação de Order ID enviada.',
            tipoSolicitacao: 'Pedido',
          },
          true,
        );
      }
      return;
    }

    // --- Preparação dos Dados do Pedido (Apto/Não Apto) ---

    let orderDataList = [];
    let pedidosParaSheet = []; // Para garantir que todos os IDs sejam registrados

    // Use the batch concurrent lookup to avoid hammering the order API
    const batchResult = await buscarStatusPedidosConcurrently(
      orderIdsExtraidos,
      {
        concurrency: 6,
        attempts: 3,
        perTicketLimit: 50,
        delayMs: 800,
      },
    );

    if (batchResult.tooMany) {
      logger.warn(
        `⚠️ Ticket ${ticketId} tem muitos Order IDs (${orderIdsExtraidos.length}). Encaminhando para humano e registrando aviso.`,
      );
      await sheetsService.registrarNoGoogleSheets(
        {
          orderId: orderIdsExtraidos.join(', '),
          mensagemDoCliente:
            mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
          lastMessage:
            'Muitos Order IDs enviados pelo cliente. Encaminhar para atendimento humano.',
          tipoSolicitacao: 'Pedido',
        },
        true,
      );
      return;
    }

    // If we have many IDs, process in chunks to avoid long blocking and watchdog hits.
    const CHUNK_SIZE = 10;
    const LARGE_THRESHOLD = 20; // if > 20 IDs, use chunking
    const idsToProcess = orderIdsExtraidos
      .map((i) => String(i).trim())
      .filter(Boolean);

    // helper to merge results into our lists with dedupe by orderId
    const seenIds = new Set();
    function pushPedido(p) {
      const oid = String(p.orderId ?? p.externalId ?? '').trim();
      if (oid && seenIds.has(oid)) return;
      if (oid) seenIds.add(oid);
      pedidosParaSheet.push(p);
      if (p && p.orderId && p.status && p.status !== 'NÃO ENCONTRADO')
        orderDataList.push(p);
    }

    if (idsToProcess.length > LARGE_THRESHOLD) {
      logger.warn(
        `⚠️ Ticket ${ticketId} possui ${idsToProcess.length} IDs — processando em chunks de ${CHUNK_SIZE}.`,
      );
      for (let i = 0; i < idsToProcess.length; i += CHUNK_SIZE) {
        const chunk = idsToProcess.slice(i, i + CHUNK_SIZE);
        logger.info(
          `🔁 Processando chunk ${Math.floor(i / CHUNK_SIZE) + 1} com ${
            chunk.length
          } IDs...`,
        );
        const r = await buscarStatusPedidosConcurrently(chunk, {
          concurrency: 6,
          attempts: chunk.length > 15 ? 1 : 2,
          perTicketLimit: 100,
          delayMs: 600,
        });
        // push found
        for (const od of r.found) {
          pushPedido({
            ...od,
            mensagemDoCliente: parsedMessage.body.replace(/\d+/g, '').trim(),
            tipoSolicitacao,
          });
        }
        // push notFound
        for (const nf of r.notFound) {
          pushPedido({
            orderId: nf,
            status: 'NÃO ENCONTRADO',
            lastMessage: 'Pedido não encontrado/erro na API após tentativas.',
          });
        }

        // Previously we wrote partial rows here. To avoid duplicate rows, defer final writes
        // until after we generate/send the final reply. Keep pedidosParaSheet populated
        // for later auditing.

        // keep pedidosParaSheet accumulated across chunks for later auditing

        // small backoff between chunks
        await new Promise((r) => setTimeout(r, 600));
      }
    } else {
      // small number of IDs: just use batchResult
      for (const od of batchResult.found) {
        pushPedido({
          ...od,
          mensagemDoCliente: parsedMessage.body.replace(/\d+/g, '').trim(),
          tipoSolicitacao,
        });
      }
      for (const nf of batchResult.notFound) {
        pushPedido({
          orderId: nf,
          status: 'NÃO ENCONTRADO',
          lastMessage: 'Pedido não encontrado/erro na API após tentativas.',
        });
      }
      // Defer writing to Sheets until after the reply is generated/sent to avoid duplicate rows.
      // pedidosParaSheet remains populated for later auditing.
    }

    // --- Geração e Envio da Resposta Final ---
    // Only generate/send a reply if we have at least one valid order in orderDataList.
    // Prepare lists of found and not found IDs to make the message explicit.
    const foundIds = orderDataList
      .map((o) => String(o.orderId ?? o.externalId).trim())
      .filter(Boolean);
    const notFoundIds = [
      ...new Set(
        orderIdsExtraidos.filter((id) => !foundIds.includes(String(id))),
      ),
    ];

    // Generate the final reply using IA helper so lastMessage reflects the real sent reply.
    try {
      respostaFinal = await gerarRespostaFinal(
        ticketId,
        tipoSolicitacao,
        foundIds,
        orderDataList,
        idiomaDetectado,
        undefined,
        undefined,
        undefined,
        { notFoundIds },
      );
    } catch (e) {
      logger.error(`❌ Erro ao gerar resposta via IA: ${e.message}`);
      respostaFinal =
        respostaFinal ||
        `Olá, recebemos sua solicitação e estamos verificando.`;
    }

    if (foundIds.length === 0) {
      // No orders found: mark action as '-' and write minimal audit rows
      if (orderDataList && orderDataList.length > 0) {
        for (const od of orderDataList) {
          const oid = String(od.orderId ?? od.externalId ?? '').trim();
          if (oid) perOrderActions.set(oid, '-');
          await sheetsService.registrarNoGoogleSheets({
            orderId: od.orderId ?? null,
            externalId: od.externalId ?? null,
            user: od.user ?? null,
            link: od.link ?? null,
            startCount: od.startCount ?? null,
            quantity: od.quantity ?? null,
            serviceId: od.serviceId ?? null,
            serviceName: od.serviceName ?? null,
            status: od.status ?? null,
            remains: od.remains ?? null,
            createdAt: od.createdAt ?? null,
            provider: od.provider ?? null,
            mensagemDoCliente:
              mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
            tipoSolicitacao: tipoSolicitacao ?? null,
            lastMessage: respostaFinal ?? 'Nenhum pedido encontrado',
            acao_realizada: '-',
          });
        }
      } else {
        for (const fid of notFoundIds) {
          const idStr = String(fid).trim();
          perOrderActions.set(idStr, '-');
          await sheetsService.registrarNoGoogleSheets({
            orderId: idStr ?? null,
            mensagemDoCliente:
              mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
            tipoSolicitacao: tipoSolicitacao ?? null,
            lastMessage: respostaFinal ?? 'Nenhum pedido encontrado',
            acao_realizada: '-',
          });
        }
      }
    } else {
      // We have at least one found order. Handle special admin flows for FAIL orders when requested.
      if (tipoSolicitacao === 'Aceleração') {
        // If acceleration requested, resend only orders that are in 'fail' status via Admin API
        try {
          const failIds = (orderDataList || [])
            .filter((o) => String(o.status ?? '').toLowerCase() === 'fail')
            .map((o) => String(o.orderId ?? o.externalId).trim())
            .filter(Boolean);

          if (failIds.length > 0) {
            logger.info(
              `ℹ️ Re-sending FAIL orders via Admin API (resend): ${failIds.join(
                ', ',
              )}`,
            );
            const resendResp = await requestResendOrders(failIds);

            const httpStatus = resendResp && resendResp.status;
            const respData =
              resendResp && resendResp.data !== undefined
                ? resendResp.data
                : resendResp;

            const containers = [];
            if (respData && typeof respData === 'object')
              containers.push(respData);
            if (respData && respData.data && typeof respData.data === 'object')
              containers.push(respData.data);

            const toArray = (v) => {
              if (!v && v !== 0) return [];
              if (Array.isArray(v)) return v.map(String);
              if (typeof v === 'string') return v.split(/\s*,\s*/).map(String);
              if (typeof v === 'object')
                return Object.values(v).flat().map(String);
              return [String(v)];
            };

            const successIdsRaw = [];
            for (const container of containers) {
              if (container && container.ids != null)
                successIdsRaw.push(...toArray(container.ids));
            }

            const rawRespStr = (() => {
              try {
                return JSON.stringify(resendResp);
              } catch (e) {
                return String(resendResp);
              }
            })();
            const truncate = (s, n = 8000) =>
              s && s.length > n ? s.slice(0, n) + '... [truncated]' : s;
            const rawRespTruncated = truncate(rawRespStr, 8000);

            const successIds = Array.from(
              new Set(successIdsRaw.map(String)),
            ).filter(Boolean);

            logger.info(
              `✅ Resend result - success: ${
                successIds.join(', ') || 'nenhum'
              }`,
            );

            // write one row per order to Sheets with audit info
            for (const od of orderDataList) {
              const oid = String(od.orderId ?? od.externalId ?? '').trim();
              const action = successIds.includes(oid) ? 'resend_sent' : '-';
              await sheetsService.registrarNoGoogleSheets({
                orderId: od.orderId ?? null,
                externalId: od.externalId ?? null,
                user: od.user ?? null,
                link: od.link ?? null,
                startCount: od.startCount ?? null,
                quantity: od.quantity ?? null,
                serviceId: od.serviceId ?? null,
                serviceName: od.serviceName ?? null,
                status: od.status ?? null,
                remains: od.remains ?? null,
                createdAt: od.createdAt ?? null,
                provider: od.provider ?? null,
                mensagemDoCliente:
                  mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                tipoSolicitacao: 'Aceleração',
                lastMessage:
                  respostaFinal ??
                  mensagemCorpoLimpo ??
                  primeiraMensagem.message ??
                  'Aceleração solicitada.',
                acao_realizada: action,
                raw_cancel_response: rawRespTruncated,
                http_status_cancel: httpStatus ?? null,
              });
            }
          } else {
            // No fail IDs to resend — still record audit rows for these orders
            // so the operator can see that an acceleration request was received
            // but no action was required (e.g. order already complete).
            for (const od of orderDataList) {
              await sheetsService.registrarNoGoogleSheets({
                orderId: od.orderId ?? null,
                externalId: od.externalId ?? null,
                user: od.user ?? null,
                link: od.link ?? null,
                startCount: od.startCount ?? null,
                quantity: od.quantity ?? null,
                serviceId: od.serviceId ?? null,
                serviceName: od.serviceName ?? null,
                status: od.status ?? null,
                remains: od.remains ?? null,
                createdAt: od.createdAt ?? null,
                provider: od.provider ?? null,
                mensagemDoCliente:
                  mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                tipoSolicitacao: 'Aceleração',
                lastMessage: respostaFinal ?? mensagemCorpoLimpo ?? null,
                acao_realizada: '-',
              });
            }
          }
        } catch (err) {
          logger.error(`❌ Erro ao requisitar resend: ${err.message}`);
          const errRaw =
            err && err.response && err.response.data
              ? JSON.stringify(err.response.data)
              : String(err.message || err);
          const truncate = (s, n = 8000) =>
            s && s.length > n ? s.slice(0, n) + '... [truncated]' : s;
          const errTruncated = truncate(errRaw, 8000);
          if (orderDataList && orderDataList.length > 0) {
            for (const od of orderDataList) {
              await sheetsService.registrarNoGoogleSheets({
                orderId: od.orderId ?? null,
                externalId: od.externalId ?? null,
                user: od.user ?? null,
                link: od.link ?? null,
                startCount: od.startCount ?? null,
                quantity: od.quantity ?? null,
                serviceId: od.serviceId ?? null,
                serviceName: od.serviceName ?? null,
                status: od.status ?? null,
                remains: od.remains ?? null,
                createdAt: od.createdAt ?? null,
                provider: od.provider ?? null,
                mensagemDoCliente:
                  mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                tipoSolicitacao: 'Aceleração',
                lastMessage:
                  respostaFinal ?? `Erro ao requisitar resend: ${err.message}`,
                acao_realizada: 'error',
                raw_cancel_response: errTruncated,
              });
            }
          }
        }
      } else if (
        tipoSolicitacao === 'Cancelamento' &&
        process.env.AUTO_CANCEL !== 'false'
      ) {
        try {
          // Determine which orders are actually cancellable based on status
          const normalCancellable = orderDataList
            .filter((o) => {
              const s = String(o.status ?? '').toLowerCase();
              return (
                s === 'pending' ||
                s === 'pendente' ||
                s === 'processing' ||
                s === 'in_progress' ||
                s === 'waiting'
              );
            })
            .map((o) => String(o.orderId ?? o.externalId).trim())
            .filter(Boolean);

          // Orders with status 'fail' should use the Admin cancel endpoint (cancel & refund)
          const adminCancelIds = orderDataList
            .filter((o) => String(o.status ?? '').toLowerCase() === 'fail')
            .map((o) => String(o.orderId ?? o.externalId).trim())
            .filter(Boolean);

          // Normalize and dedupe lists
          const uniqueNormal = Array.from(new Set(normalCancellable));
          const uniqueAdmin = Array.from(new Set(adminCancelIds)).filter(
            (id) => !uniqueNormal.includes(id),
          );

          const nonCancellable = foundIds.filter(
            (id) =>
              !uniqueNormal.includes(String(id)) &&
              !uniqueAdmin.includes(String(id)),
          );

          if (uniqueNormal.length === 0 && uniqueAdmin.length === 0) {
            logger.info(
              `ℹ️ Nenhum pedido elegível para cancelamento automático. Não elegíveis: ${
                nonCancellable.join(', ') || 'nenhum'
              }`,
            );
            // Register one row per found order with action '-' (none performed)
            if (orderDataList && orderDataList.length > 0) {
              for (const od of orderDataList) {
                await sheetsService.registrarNoGoogleSheets({
                  orderId: od.orderId ?? null,
                  externalId: od.externalId ?? null,
                  user: od.user ?? null,
                  link: od.link ?? null,
                  startCount: od.startCount ?? null,
                  quantity: od.quantity ?? null,
                  serviceId: od.serviceId ?? null,
                  serviceName: od.serviceName ?? null,
                  status: od.status ?? null,
                  remains: od.remains ?? null,
                  createdAt: od.createdAt ?? null,
                  provider: od.provider ?? null,
                  mensagemDoCliente:
                    mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                  tipoSolicitacao: 'Cancelamento',
                  lastMessage:
                    respostaFinal ??
                    mensagemCorpoLimpo ??
                    primeiraMensagem.message ??
                    `Solicitação de cancelamento detectada, mas nenhum pedido elegível para cancelamento automático. Não elegíveis: ${
                      nonCancellable.join(', ') || 'nenhum'
                    }`,
                  acao_realizada: '-',
                });
              }
            } else {
              for (const fid of foundIds) {
                await sheetsService.registrarNoGoogleSheets({
                  orderId: fid ?? null,
                  mensagemDoCliente:
                    mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                  tipoSolicitacao: 'Cancelamento',
                  lastMessage:
                    respostaFinal ??
                    mensagemCorpoLimpo ??
                    primeiraMensagem.message ??
                    `Solicitação de cancelamento detectada, mas nenhum pedido elegível para cancelamento automático. Não elegíveis: ${
                      nonCancellable.join(', ') || 'nenhum'
                    }`,
                  acao_realizada: '-',
                });
              }
            }
          } else {
            // We'll call the Admin cancel endpoint for 'fail' orders and the regular cancel endpoint for others.
            logger.info(
              `ℹ️ Tentando cancelar (admin) IDs fail: ${
                uniqueAdmin.join(', ') || 'nenhum'
              }; regular cancel IDs: ${uniqueNormal.join(', ') || 'nenhum'}`,
            );

            const debugApi = process.env.DEBUG_API === 'true';

            // accumulators
            const successIdsRaw = [];
            const skippedIdsRaw = [];
            const rawResponses = [];
            let httpStatusCombined = null;

            // Helper to parse various response shapes
            const toArray = (v) => {
              if (!v && v !== 0) return [];
              if (Array.isArray(v)) return v.map(String);
              if (typeof v === 'string') return v.split(/\s*,\s*/).map(String);
              if (typeof v === 'object')
                return Object.values(v).flat().map(String);
              return [String(v)];
            };

            const candidateKeysForSuccess = [
              'ids',
              'data',
              'success',
              'cancelled',
              'cancelled_ids',
              'success_ids',
            ];
            const candidateKeysForSkipped = [
              'skipped_ids',
              'skipped',
              'failed',
              'failed_ids',
            ];

            // 1) Admin cancel for fail orders
            if (uniqueAdmin.length > 0) {
              try {
                const adminReason = process.env.CANCEL_REASON || '';
                const adminResp = await requestAdminCancelOrders(
                  uniqueAdmin,
                  adminReason,
                );
                rawResponses.push(adminResp);
                httpStatusCombined =
                  (adminResp && adminResp.status) || httpStatusCombined;
                const respData =
                  adminResp && adminResp.data !== undefined
                    ? adminResp.data
                    : adminResp;
                const containers = [];
                if (respData && typeof respData === 'object')
                  containers.push(respData);
                if (
                  respData &&
                  respData.data &&
                  typeof respData.data === 'object'
                )
                  containers.push(respData.data);
                for (const container of containers) {
                  for (const k of candidateKeysForSuccess) {
                    if (container && container[k] != null)
                      successIdsRaw.push(...toArray(container[k]));
                  }
                  for (const k of candidateKeysForSkipped) {
                    if (container && container[k] != null)
                      skippedIdsRaw.push(...toArray(container[k]));
                  }
                }
              } catch (errAdmin) {
                logger.error(
                  `❌ Erro ao requisitar admin cancel para fails: ${errAdmin.message}`,
                );
                const errRaw =
                  errAdmin && errAdmin.response && errAdmin.response.data
                    ? JSON.stringify(errAdmin.response.data)
                    : String(errAdmin.message || errAdmin);
                const truncate = (s, n = 8000) =>
                  s && s.length > n ? s.slice(0, n) + '... [truncated]' : s;
                const errTruncated = truncate(errRaw, 8000);
                // record error rows for affected orders
                for (const id of uniqueAdmin) {
                  await sheetsService.registrarNoGoogleSheets({
                    orderId: id ?? null,
                    mensagemDoCliente:
                      mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                    tipoSolicitacao: 'Cancelamento',
                    lastMessage:
                      respostaFinal ??
                      `Erro ao requisitar admin cancel: ${errAdmin.message}`,
                    acao_realizada: 'error_admin',
                    raw_cancel_response: errTruncated,
                  });
                }
              }
            }

            // 2) Regular cancel for normal cancellable orders
            if (uniqueNormal.length > 0) {
              try {
                const cancelResp = await requestCancelOrders(uniqueNormal);
                rawResponses.push(cancelResp);
                httpStatusCombined =
                  (cancelResp && cancelResp.status) || httpStatusCombined;
                const respData =
                  cancelResp && cancelResp.data !== undefined
                    ? cancelResp.data
                    : cancelResp;
                const containers = [];
                if (respData && typeof respData === 'object')
                  containers.push(respData);
                if (
                  respData &&
                  respData.data &&
                  typeof respData.data === 'object'
                )
                  containers.push(respData.data);
                for (const container of containers) {
                  for (const k of candidateKeysForSuccess) {
                    if (container && container[k] != null)
                      successIdsRaw.push(...toArray(container[k]));
                  }
                  for (const k of candidateKeysForSkipped) {
                    if (container && container[k] != null)
                      skippedIdsRaw.push(...toArray(container[k]));
                  }
                }
              } catch (errCancel) {
                logger.error(
                  `❌ Erro ao requisitar cancel (regular): ${errCancel.message}`,
                );
                const errRaw =
                  errCancel && errCancel.response && errCancel.response.data
                    ? JSON.stringify(errCancel.response.data)
                    : String(errCancel.message || errCancel);
                const truncate = (s, n = 8000) =>
                  s && s.length > n ? s.slice(0, n) + '... [truncated]' : s;
                const errTruncated = truncate(errRaw, 8000);
                for (const id of uniqueNormal) {
                  await sheetsService.registrarNoGoogleSheets({
                    orderId: id ?? null,
                    mensagemDoCliente:
                      mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                    tipoSolicitacao: 'Cancelamento',
                    lastMessage:
                      respostaFinal ??
                      `Erro ao requisitar cancel: ${errCancel.message}`,
                    acao_realizada: 'error',
                    raw_cancel_response: errTruncated,
                  });
                }
              }
            }

            // Aggregate successes/skips
            const successIds = Array.from(
              new Set(successIdsRaw.map(String)),
            ).filter(Boolean);
            const skippedIds = Array.from(
              new Set(skippedIdsRaw.map(String)),
            ).filter(Boolean);

            // Distinguish which successes came from admin cancel vs regular cancel
            const successAdminSet = new Set(
              successIds.filter((id) => uniqueAdmin.includes(String(id))),
            );
            const successNormalSet = new Set(
              successIds.filter((id) => uniqueNormal.includes(String(id))),
            );

            // Truncate and combine raw responses for storage
            const rawRespStr = (() => {
              try {
                return JSON.stringify(rawResponses);
              } catch (e) {
                return String(rawResponses);
              }
            })();
            const truncate = (s, n = 8000) =>
              s && s.length > n ? s.slice(0, n) + '... [truncated]' : s;
            const rawRespTruncated = truncate(rawRespStr, 8000);

            logger.info(
              `✅ Resultado do pedido de cancelamento - sucesso: ${
                successIds.join(', ') || 'nenhum'
              }; pulados: ${skippedIds.join(', ') || 'nenhum'}`,
            );

            // Prepare action summary for Sheets
            const sentIdsStr = successIds.join(',') || '';
            const skippedIdsStr = skippedIds.join(',') || '';
            acaoRealizadaForSheet = sentIdsStr
              ? `cancel_sent: sent=${sentIdsStr}${
                  skippedIdsStr ? `; skipped=${skippedIdsStr}` : ''
                }`
              : `cancel_sent: none; skipped=${skippedIdsStr || 'none'}`;

            // Record one row per order with full details and action performed
            for (const od of orderDataList) {
              const oid = String(od.orderId ?? od.externalId ?? '').trim();
              const action = successAdminSet.has(oid)
                ? `cancel_done`
                : successNormalSet.has(oid)
                ? `cancel_sent`
                : skippedIds.includes(oid)
                ? `cancel_skipped`
                : '-';
              await sheetsService.registrarNoGoogleSheets({
                orderId: od.orderId ?? null,
                externalId: od.externalId ?? null,
                user: od.user ?? null,
                link: od.link ?? null,
                startCount: od.startCount ?? null,
                quantity: od.quantity ?? null,
                serviceId: od.serviceId ?? null,
                serviceName: od.serviceName ?? null,
                status: od.status ?? null,
                remains: od.remains ?? null,
                createdAt: od.createdAt ?? null,
                provider: od.provider ?? null,
                mensagemDoCliente:
                  mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                tipoSolicitacao: 'Cancelamento',
                // Do not include internal success/skipped IDs in the customer-facing lastMessage.
                lastMessage:
                  respostaFinal ??
                  mensagemCorpoLimpo ??
                  primeiraMensagem.message ??
                  'Solicitação de cancelamento recebida.',
                acao_realizada: action,
                raw_cancel_response: rawRespTruncated,
                http_status_cancel: httpStatusCombined ?? null,
              });
            }
          }
        } catch (err) {
          logger.error(`❌ Erro ao solicitar cancelamento: ${err.message}`);
          const errRaw =
            err && err.response && err.response.data
              ? JSON.stringify(err.response.data)
              : String(err.message || err);
          const truncate = (s, n = 8000) =>
            s && s.length > n ? s.slice(0, n) + '... [truncated]' : s;
          const errTruncated = truncate(errRaw, 8000);
          // write one error row per order for audit
          if (orderDataList && orderDataList.length > 0) {
            for (const od of orderDataList) {
              await sheetsService.registrarNoGoogleSheets({
                orderId: od.orderId ?? null,
                externalId: od.externalId ?? null,
                user: od.user ?? null,
                link: od.link ?? null,
                startCount: od.startCount ?? null,
                quantity: od.quantity ?? null,
                serviceId: od.serviceId ?? null,
                serviceName: od.serviceName ?? null,
                status: od.status ?? null,
                remains: od.remains ?? null,
                createdAt: od.createdAt ?? null,
                provider: od.provider ?? null,
                mensagemDoCliente:
                  mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                tipoSolicitacao: 'Cancelamento',
                lastMessage:
                  respostaFinal ??
                  `Erro ao solicitar cancelamento: ${err.message}`,
                acao_realizada: 'error',
                raw_cancel_response: errTruncated,
              });
            }
          } else {
            for (const fid of foundIds) {
              await sheetsService.registrarNoGoogleSheets({
                orderId: fid ?? null,
                mensagemDoCliente:
                  mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
                tipoSolicitacao: 'Cancelamento',
                lastMessage:
                  respostaFinal ??
                  `Erro ao solicitar cancelamento: ${err.message}`,
                acao_realizada: 'error',
                raw_cancel_response: errTruncated,
              });
            }
          }
        }
      } else {
        // Not a cancellation flow or AUTO_CANCEL disabled: write audit rows with no action
        for (const od of orderDataList) {
          await sheetsService.registrarNoGoogleSheets({
            orderId: od.orderId ?? null,
            externalId: od.externalId ?? null,
            user: od.user ?? null,
            link: od.link ?? null,
            startCount: od.startCount ?? null,
            quantity: od.quantity ?? null,
            serviceId: od.serviceId ?? null,
            serviceName: od.serviceName ?? null,
            status: od.status ?? null,
            remains: od.remains ?? null,
            createdAt: od.createdAt ?? null,
            provider: od.provider ?? null,
            mensagemDoCliente:
              mensagemCorpoLimpo ?? primeiraMensagem.message ?? null,
            tipoSolicitacao: tipoSolicitacao ?? null,
            lastMessage: respostaFinal ?? null,
            acao_realizada: '-',
          });
        }
      }
    }

    logger.info(`✉️ Resposta gerada: ${respostaFinal}`);
    if (respostaFinal && !respostaEnviada) {
      logger.info(`📝 Enviando resposta para o ticket ${ticketId}.`);
      await responderTicket(ticketId, respostaFinal);
      respostaEnviada = true;
    }
    // After sending the reply, ensure any remaining pedidosParaSheet (e.g. notFound entries)
    // are written once. We skip orders that were already handled (foundIds).
    try {
      if (pedidosParaSheet && pedidosParaSheet.length > 0) {
        for (const pedido of pedidosParaSheet) {
          const oid = String(pedido.orderId ?? pedido.externalId ?? '').trim();
          if (!oid) continue;
          // if this id was part of foundIds, it was already written above
          if (foundIds.includes(oid)) continue;
          await sheetsService.registrarNoGoogleSheets({
            orderId: pedido.orderId ?? null,
            externalId: pedido.externalId ?? null,
            user: pedido.user ?? null,
            link: pedido.link ?? null,
            startCount: pedido.startCount ?? null,
            quantity: pedido.quantity ?? null,
            serviceId: pedido.serviceId ?? null,
            serviceName: pedido.serviceName ?? null,
            status: pedido.status ?? null,
            remains: pedido.remains ?? null,
            createdAt: pedido.createdAt ?? null,
            provider: pedido.provider ?? null,
            mensagemDoCliente:
              pedido.mensagemDoCliente ??
              mensagemCorpoLimpo ??
              primeiraMensagem.message ??
              null,
            tipoSolicitacao: pedido.tipoSolicitacao ?? tipoSolicitacao ?? null,
            lastMessage: respostaFinal ?? null,
            acao_realizada: perOrderActions.get(oid) ?? '-',
          });
        }
      }
    } catch (e) {
      logger.error(
        `❌ Erro ao gravar pedidos restantes no Sheets: ${e.message}`,
      );
    }
    // Força flush do buffer do Sheets para garantir que todos os registros deste ticket sejam salvos imediatamente
    if (sheetsService.flushPendingWrites) {
      await sheetsService.flushPendingWrites();
    }
    // --- Registro Final no Google Sheets ---
    // Removido: não registrar novamente os pedidos aqui, pois já foi feito nos chunks/batch
    // for (const pedido of pedidosParaSheet) { ... }
  } catch (error) {
    logger.error(
      `❌ Erro [Processamento Geral]: Ticket ${ticketId}: ${error.message}`,
    );
  } finally {
    finishTicketLog(); // Finaliza e salva o log do ticket
    separador();
  }
}

// --- Funções de Controle (Logs ajustados) ---

async function processarTodosTickets() {
  try {
    logger.info('🔎 Checando novos tickets na API...');
    const tickets = await listarTickets();
    const lastExecution = await obterUltimaExecucao();
    if (tickets.length === 0) {
      logger.info('📭 Nenhum ticket encontrado. Finalizando ciclo.');
      return;
    }

    const ticketsParaProcessar = tickets.filter((ticket) => {
      const lastUpdateTime = new Date(ticket.last_update_timestamp * 1000);
      return lastUpdateTime > new Date(lastExecution);
    });

    logger.info(
      `🛠 ${tickets.length} tickets encontrados. ${ticketsParaProcessar.length} com novas mensagens.`,
    );

    if (ticketsParaProcessar.length === 0) {
      logger.info(
        '🟡 Nenhum novo ticket ou mensagem desde a última verificação.',
      );
      return;
    }
    logger.info(
      `✅ Iniciando processamento de ${ticketsParaProcessar.length} ticket(s) atualizados.`,
    );

    for (const ticket of ticketsParaProcessar) {
      await processarTicket(ticket.id, lastExecution);
    }
    await atualizarUltimaExecucao();
    logger.info(`✅ Última execução atualizada com sucesso.`);
  } catch (erro) {
    logger.error(`❌ Erro [Processar Todos]: ${erro.message}`);
  }
}

// ... (iniciarAutomacao, pararAutomacao, e o watchdog permanecem inalterados) ...

let isProcessing = false;
let automationInterval;
let lastExecutionTime; // Variável para o watchdog
const INTERVALO_AUTOMACAO = 60000;
const INTERVALO_WATCHDOG = 60000;

function iniciarAutomacao() {
  logger.info(chalk.green.bold('✅ Iniciando a automação...'));
  automationInterval = setInterval(async () => {
    if (isProcessing) return;
    isProcessing = true;
    logger.info('--- 🔁 Ciclo de Automação Iniciado ---');
    try {
      lastExecutionTime = Date.now();
      await processarTodosTickets();
    } catch (erro) {
      logger.error(`❌ Erro [Ciclo]: ${erro.message}`);
    } finally {
      isProcessing = false;
    }
    logger.info('--- ⏹️  Ciclo de Automação Finalizado ---\n');
  }, INTERVALO_AUTOMACAO);
}

function pararAutomacao() {
  logger.info(chalk.red.bold('🛑 Parando a automação...'));
  setTimeout(() => {
    logger.warn(chalk.yellow.bold('⚠️ Automação parada.'));
    clearInterval(automationInterval);
  }, 1000);
}

setInterval(() => {
  try {
    if (
      isProcessing &&
      typeof lastExecutionTime !== 'undefined' &&
      Date.now() - lastExecutionTime > 60000
    ) {
      logger.error(
        chalk.red.bold(
          '⚠️ WATCHDOG: Automação travada! Reiniciando o processo...',
        ),
      );
      isProcessing = false;
      pararAutomacao();
      iniciarAutomacao();
    }
  } catch (erro) {
    logger.error(`❌ Erro [Watchdog]: ${erro.message}`);
  }
}, INTERVALO_WATCHDOG);

// Do not auto-start the automation by default. If this process is forked and
// has an IPC channel, listen for 'start'/'stop' messages from the parent.
if (process && process.send) {
  process.on('message', (msg) => {
    if (msg === 'start') {
      logger.info('⏯️ Recebido comando START via IPC. Iniciando automação.');
      // Send explicit ACK to parent so main can display confirmation
      try {
        process.send &&
          process.send({ type: 'ack', cmd: 'start', pid: process.pid });
      } catch (e) {
        logger.warn(`Não conseguiu enviar ACK_START ao parent: ${e.message}`);
      }
      iniciarAutomacao();
      // notify parent that automation started
      try {
        process.send &&
          process.send({
            type: 'status',
            status: 'automation_started',
            pid: process.pid,
          });
      } catch (e) {
        logger.warn(
          `Não conseguiu enviar status automation_started ao parent: ${e.message}`,
        );
      }
    }
    if (msg === 'stop') {
      logger.info('⏯️ Recebido comando STOP via IPC. Parando automação.');
      try {
        process.send &&
          process.send({ type: 'ack', cmd: 'stop', pid: process.pid });
      } catch (e) {
        logger.warn(`Não conseguiu enviar ACK_STOP ao parent: ${e.message}`);
      }
      pararAutomacao();
      try {
        process.send &&
          process.send({
            type: 'status',
            status: 'automation_stopped',
            pid: process.pid,
          });
      } catch (e) {
        logger.warn(
          `Não conseguiu enviar status automation_stopped ao parent: ${e.message}`,
        );
      }
    }
  });
} else {
  // For backwards compatibility, allow env var AUTO_START to auto-start
  if (process.env.AUTO_START === 'true') {
    iniciarAutomacao();
  }
}

export {
  iniciarAutomacao,
  pararAutomacao,
  processarTodosTickets,
  processarTicket,
};
