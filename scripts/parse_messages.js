// Script para parsear mensagens brutas e extrair: assunto, orderId(s), e corpo (priorizando conteúdo após <hr>)

function extractHtmlTags(raw) {
  // return array of bold tag contents e.g. ['Orders - Refill', 'Order ID']
  const bolds = [];
  const re = /<b>(.*?)<\/b>/gi;
  let m;
  while ((m = re.exec(raw))) {
    bolds.push(m[1].trim());
  }
  return bolds;
}

function extractOrderIds(raw) {
  const ids = [];

  // 1) Explicit labeled Order ID in HTML or plain text
  const htmlLabeled = raw.match(
    /<b>\s*Order\s*ID\s*<\/b>\s*[:\s]*([^<\n\r\s]+)/i,
  );
  if (htmlLabeled && htmlLabeled[1])
    ids.push({ id: htmlLabeled[1].trim(), confidence: 'high' });

  const plainLabeled = raw.match(/Order\s*ID[:\s]*([0-9]+)/i);
  if (plainLabeled && plainLabeled[1])
    ids.push({ id: plainLabeled[1].trim(), confidence: 'high' });

  // 2) Any digit runs (fallback) - capture 3-12 digits inside or outside words
  const digitMatches = [...new Set(raw.match(/\d{1,12}/g) || [])];
  for (const d of digitMatches) {
    // skip if already captured
    if (ids.find((x) => x.id === d)) continue;
    // heuristic: prefer length >=6 as medium confidence, <6 low
    const conf = d.length >= 6 ? 'medium' : 'low';
    ids.push({ id: d, confidence: conf });
  }

  return ids;
}

function splitByHr(raw) {
  // Split by <hr>, <hr/> or variants, or by three or more dashes/underscores on their own line
  const parts = raw.split(/<hr\s*\/?>(?:\s*)/i);
  if (parts.length > 1) {
    // return [beforeLastHr, afterLastHr]
    const before = parts.slice(0, parts.length - 1).join('<hr>');
    const after = parts[parts.length - 1];
    return { before, after };
  }
  // fallback: try plaintext separators
  const dashSplit = raw.split(/\n-{3,}\n/);
  if (dashSplit.length > 1)
    return {
      before: dashSplit.slice(0, -1).join('\n---\n'),
      after: dashSplit.slice(-1)[0],
    };
  return { before: raw, after: '' };
}

function stripHtml(raw) {
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/\r/g, '')
    .trim();
}

function parseRawMessage(raw) {
  const bolds = extractHtmlTags(raw);
  const { before, after } = splitByHr(raw);

  // subject heuristic: first bold content if it looks like a label (contains non-digit)
  const subject = bolds.length > 0 ? bolds[0] : null;

  // order ids
  const orderIds = extractOrderIds(raw);

  // body priority: text after <hr> if exists and non-empty, else body from 'before' with subject and order id stripped
  let bodyRaw = after && after.trim() ? after : before;

  // remove subject bold block from body if it appears at start
  if (
    subject &&
    bodyRaw.startsWith('<div') &&
    bodyRaw.indexOf(subject) !== -1
  ) {
    // remove first occurrence of subject block
    bodyRaw = bodyRaw.replace(
      new RegExp(
        `<div[^>]*>\s*<b>\s*${escapeRegExp(subject)}\s*<\\/b>\s*<\\/div>`,
        'i',
      ),
      '',
    );
  }

  // also remove <b>Order ID</b>... block if present
  bodyRaw = bodyRaw.replace(
    /<div>\s*<b>\s*Order\s*ID\s*<\/b>\s*[:\s]*[^<]*<\/div>/i,
    '',
  );

  const body = stripHtml(bodyRaw);

  // Post-process: if body is just a number (client only wrote a number), that might actually be the orderId
  const onlyDigits = body.match(/^\d+$/);
  const interpretedOrderIds = [...orderIds];
  if (onlyDigits) {
    // add with high confidence if not present
    if (!interpretedOrderIds.find((x) => x.id === onlyDigits[0]))
      interpretedOrderIds.unshift({ id: onlyDigits[0], confidence: 'high' });
  }

  return {
    raw: raw,
    subject: subject,
    orderIds: interpretedOrderIds,
    bodyRaw: bodyRaw.trim(),
    body: body,
  };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Example run with the messages you provided ---
const exampleMessages = [
  'I need refund for order 1234',
  'speedUp please',
  '56733 - Speedup Please',
  '<div><b>Orders - Refill</b></div><hr>speedUp please',
  '<div><b>Orders - Cancel</b></div><hr>oi',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 1</div><hr>speed please',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 1</div><hr>speed please',
  '1',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 1</div><hr>speedUp',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 550039</div><hr>speed',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 1</div><hr>refill please',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 1</div><hr>refill please',
  '<div><b>Orders - Refill</b></div><hr>i need refill',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 1</div><hr>i need refill',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 1</div><hr>i need refill',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 4334</div><hr>3443',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 4334</div><hr>3434',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 23232</div><hr>2323',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 1212121</div><hr>teste4',
  '<div><b>Orders - Speed up</b></div><hr>teste2',
  'order 12345',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 18584</div><hr>teste',
  'oi',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 550039</div><hr>teste',
  'oi\n,',
  '<div><b>Orders - Refill</b></div><div><b>Order ID</b>: 550039</div><hr>oi',
  'oii',
];

for (const m of exampleMessages) {
  const parsed = parseRawMessage(m);
  console.log('---');
  console.log('Raw:', m);
  console.log('Subject:', parsed.subject);
  console.log(
    'Order IDs:',
    parsed.orderIds.map((x) => `${x.id}(${x.confidence})`).join(', ') || 'none',
  );
  console.log('Body:', parsed.body);
}

// Export function for reuse
export { parseRawMessage, stripHtml };
