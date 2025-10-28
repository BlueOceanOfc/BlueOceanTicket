/**
 * utils.js (Versão Unificada e Otimizada)
 * Contém todas as funções de parsing, limpeza e manipulação de IDs.
 */

// --- Helpers Internos de Parsing Avançado (do 1º Bloco) ---

/**
 * Extrai textos em negrito (<b>...</b>), que geralmente indicam o assunto/título.
 * @param {string} raw - Mensagem bruta (incluindo HTML).
 * @returns {string[]} Lista de textos em negrito.
 */
function extractHtmlTags(raw) {
  const bolds = [];
  const re = /<b>(.*?)<\/b>/gi;
  let m;
  // O re.exec() é crucial para iterar sobre todas as ocorrências de regex.
  while ((m = re.exec(raw))) {
    bolds.push(m[1].trim());
  }
  return bolds;
}

/**
 * Separa a mensagem por divisores (como <hr> ou ---) para isolar o corpo da mensagem
 * de assinaturas ou histórico de conversa.
 * @param {string} raw - Mensagem bruta.
 * @returns {{before: string, after: string}} O que veio antes e depois do divisor.
 */
function splitByHr(raw) {
  // 1. Busca por <hr> (mais confiável em ambientes de ticket HTML)
  const parts = raw.split(/<hr\s*\/?>(?:\s*)/i);
  if (parts.length > 1) {
    // Assume que a última parte é o conteúdo mais recente/relevante.
    const before = parts.slice(0, parts.length - 1).join('<hr>');
    const after = parts[parts.length - 1];
    return { before, after };
  }
  // 2. Fallback para divisores de texto (---)
  const dashSplit = raw.split(/\n-{3,}\n/);
  if (dashSplit.length > 1)
    return {
      before: dashSplit.slice(0, -1).join('\n---\n'),
      after: dashSplit.slice(-1)[0],
    };
  return { before: raw, after: '' };
}

/**
 * Remove todas as tags HTML e limpa espaços.
 * @param {string} raw - Texto que pode conter HTML.
 * @returns {string} Texto limpo.
 */
function stripHtml(raw) {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/\r/g, '')
    .trim();
}

/**
 * Escapa strings para uso seguro em expressões regulares (RegExp).
 * @param {string} string - String a ser escapada.
 * @returns {string} String escapada.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Função utilitária do 2º bloco (que estava sendo usada no AI file) - aprimorada
 * Corta a mensagem focando no conteúdo mais recente (assumindo que o título está no início).
 * Usada para alimentar o prompt de IA com o texto mais "limpo" possível.
 * @param {string} mensagemOriginal - Mensagem bruta do cliente.
 * @returns {string} O corpo da mensagem relevante.
 */
export function cortarMensagemUtil(mensagemOriginal) {
  // Tenta usar a lógica avançada primeiro
  const parsed = parseRawMessage(mensagemOriginal);
  if (parsed.body) return parsed.body;

  // Fallback: lógica original (menos confiável, mas mantém a compatibilidade)
  const primeiraTagFechamento = mensagemOriginal.indexOf('</b>');
  if (primeiraTagFechamento === -1) return mensagemOriginal;

  let segundaTagFechamento = mensagemOriginal.indexOf(
    '</b>',
    primeiraTagFechamento + 1,
  );

  if (segundaTagFechamento === -1)
    return mensagemOriginal.slice(primeiraTagFechamento + 4).trim();

  return mensagemOriginal.slice(segundaTagFechamento + 4).trim();
}

// --- Funções Principais Otimizadas para Exportação ---

/**
 * Função de parsing MAIS COMPLETA e ROBUSTA.
 * Extrai assunto, Order IDs com confiança e o corpo da mensagem.
 * @param {string} raw - Mensagem bruta (incluindo HTML).
 * @returns {{raw: string, subject: string|null, orderIds: {id: string, confidence: string}[], bodyRaw: string, body: string}}
 */
export function parseRawMessage(raw) {
  const bolds = extractHtmlTags(raw);
  const { before, after } = splitByHr(raw);

  // Sujeito é o primeiro item em negrito (comum em layouts de ticket)
  const subject = bolds.length > 0 ? bolds[0] : null;

  // A extração de IDs deve ser feita no RAW, pois tags podem ajudar
  const idsWithConf = extractOrderIdsWithConfidence(raw);

  // Define o corpo da mensagem: se houver divisor (<hr>/---), usa o 'after'.
  let bodyRaw = after && after.trim() ? after : before;

  // Tenta remover o assunto do corpo, se ele estiver formatado como título HTML
  if (
    subject &&
    bodyRaw.startsWith('<div') &&
    bodyRaw.indexOf(subject) !== -1
  ) {
    bodyRaw = bodyRaw.replace(
      new RegExp(
        `<div[^>]*>\\s*<b>\\s*${escapeRegExp(subject)}\\s*<\\/b>\\s*<\\/div>`,
        'i',
      ),
      '',
    );
  }

  // Remove o rótulo "Order ID: xxxxx" do corpo da mensagem
  bodyRaw = bodyRaw.replace(
    /<div>\s*<b>\s*Order\s*ID\s*<\/b>\s*[:\s]*[^<]*<\/div>/i,
    '',
  );

  const body = stripHtml(bodyRaw);

  // Adiciona o Order ID se a mensagem for *apenas* um número com ao menos 3 dígitos
  const onlyDigits = body.match(/^\d{3,}$/);
  const interpretedOrderIds = [...idsWithConf];
  if (onlyDigits) {
    if (!interpretedOrderIds.find((x) => x.id === onlyDigits[0]))
      interpretedOrderIds.unshift({ id: onlyDigits[0], confidence: 'high' });
  }

  return {
    raw: raw,
    subject: subject,
    orderIds: interpretedOrderIds,
    bodyRaw: bodyRaw.trim(),
    body: body, // Texto limpo para a IA
  };
}

/**
 * Combinação da extração de IDs com a lógica de confiança (do 1º bloco).
 * Retorna IDs com metadados de confiança.
 * @param {string} raw - Mensagem bruta.
 * @returns {{id: string, confidence: string}[]} Lista de IDs e sua confiança.
 */
function extractOrderIdsWithConfidence(raw) {
  const ids = [];

  // 1. Alto Confiança: Order ID explicitamente rotulado com HTML <b>
  // 1. Alto Confiança: Order ID explicitamente rotulado com HTML <b>
  // Captura tudo até a próxima tag ou quebra de linha e extrai números (pode ser uma lista como "1, 2,3").
  const htmlLabeled = raw.match(
    /<b>\s*Order\s*ID\s*<\/b>\s*[:\s]*([^<\n\r]*)/i,
  );
  if (htmlLabeled && htmlLabeled[1]) {
    // Consider only numeric runs with at least 3 digits
    const found = htmlLabeled[1].match(/\d{3,12}/g) || [];
    for (const f of found) {
      ids.push({ id: f.trim(), confidence: 'high' });
    }
  }

  // 2. Alto Confiança: Order ID explicitamente rotulado em texto simples
  // 2. Alto Confiança: Order ID explicitamente rotulado em texto simples
  // Captura até quebra de linha ou pontuação e extrai todos os números presentes
  const plainLabeled = raw.match(/Order\s*ID[:\s]*([^\n\r<]*)/i);
  if (plainLabeled && plainLabeled[1]) {
    const foundPlain = plainLabeled[1].match(/\d{3,12}/g) || [];
    for (const f of foundPlain) {
      ids.push({ id: f.trim(), confidence: 'high' });
    }
  }

  // 3. Média/Baixa Confiança: Todos os outros números que parecem IDs (dígitos)
  // Usa Set para garantir unicidade
  // Only numeric runs of minimum 3 digits
  const digitMatches = [...new Set(raw.match(/\d{3,12}/g) || [])];
  // If the message contains multiple numeric tokens (like "1,2,3,4" or "1 2 3 4"),
  // it's likely the client sent multiple order IDs. In that case, promote all
  // digit runs to 'medium' confidence even if each is short.
  const treatMultipleAsMedium = digitMatches.length >= 2;

  for (const d of digitMatches) {
    // Normalize and avoid duplicating numeric-only ids
    const cleanD = String(d).replace(/\D/g, '').trim();
    if (!cleanD) continue;
    if (ids.find((x) => String(x.id).replace(/\D/g, '').trim() === cleanD))
      continue; // Evita duplicidade

    // Regra de heurística: tratar sequências com 3 ou mais dígitos como candidatas
    // de média confiança; sequências menores são baixa confiança, exceto quando
    // o cliente enviou múltiplos números (lista de IDs), então elevamos para
    // média confiança também.
    let conf = 'low';
    if (d.length >= 3) conf = 'medium';
    if (treatMultipleAsMedium) conf = 'medium';
    ids.push({ id: cleanD, confidence: conf });
  }
  // Final normalization: ensure all ids are digit-only strings and unique (preserve order)
  const seen = new Set();
  const normalized = [];
  for (const it of ids) {
    const onlyDigits = String(it.id).replace(/\D/g, '').trim();
    if (!onlyDigits) continue;
    if (seen.has(onlyDigits)) continue;
    seen.add(onlyDigits);
    normalized.push({ id: onlyDigits, confidence: it.confidence });
  }
  return normalized;
}

/**
 * Função OTIMIZADA de extração de IDs para uso no "AI file" (mantém a interface original).
 * Retorna apenas uma lista simples de strings de IDs, priorizando a confiança.
 * @param {string} mensagem - Mensagem bruta ou limpa.
 * @returns {string[]} Lista de Order IDs únicos.
 */
export function extrairTodosOrderIds(mensagem) {
  if (!mensagem) return [];

  // Usa o parser avançado para extrair todos os IDs com confiança
  const idsWithConf = extractOrderIdsWithConfidence(mensagem);

  // Prioriza IDs de alta/média confiança, remove a baixa confiança por padrão.
  const filteredIds = idsWithConf
    .filter((item) => item.confidence !== 'low')
    .map((item) => item.id);

  return [...new Set(filteredIds)];
}

/**
 * Formata Order IDs em uma string separada por vírgulas.
 * @param {string[] | string} ids - Lista de IDs ou um único ID.
 * @returns {string} IDs formatados.
 */
export function formatIds(ids) {
  return Array.isArray(ids) ? ids.join(', ') : String(ids);
}

/**
 * Agrupa dados de pedidos por status.
 * @param {object[]} orderDataList - Lista de dados do pedido (retorno da API).
 * @returns {{completed: string[], canceled: string[], pendente: string[], invalidos: string[]}}
 */
export function agruparPedidos(orderDataList) {
  const pedidos = { completed: [], canceled: [], pendente: [], invalidos: [] };
  if (!Array.isArray(orderDataList)) return pedidos;

  for (const orderData of orderDataList) {
    if (!orderData || !orderData.status) {
      pedidos.invalidos.push(orderData?.orderId || '(unknown)');
      continue;
    }
    const status = orderData.status.toLowerCase();
    const id = String(orderData.orderId);

    if (status === 'completed') pedidos.completed.push(id);
    else if (status === 'canceled') pedidos.canceled.push(id);
    else pedidos.pendente.push(id);
  }
  return pedidos;
}

// --- Funções do 2º Bloco que mantêm a interface, mas são menos cruciais para o fluxo de IA ---

// Mantido para compatibilidade, mas o fluxo da IA deve usar 'cortarMensagemUtil' que chama 'parseRawMessage'
export function limparMensagem(mensagem) {
  if (!mensagem || typeof mensagem !== 'string') return '';
  return mensagem
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Mantido para compatibilidade, mas com uso limitado no fluxo principal
export function tirarNumero(mensagem) {
  if (!mensagem || typeof mensagem !== 'string') return '';
  return mensagem.replace(/\d+/g, '').trim();
}

// Mantido para debug/visualização
export function separador() {
  console.log('------------------------------------------------------------');
}
