import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

// --- util: find .env ---
function findEnvPath() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.resolve(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd(), '..', '.env');
}

dotenv.config({ path: findEnvPath() });

const API_KEY = process.env.API_KEY;
const TICKET_API_BASE_URL = process.env.TICKET_API_BASE_URL;

if (!API_KEY || !TICKET_API_BASE_URL) {
  console.error('Missing API_KEY or TICKET_API_BASE_URL in .env.');
  process.exit(1);
}

// --- parser logic (adapted from parse_messages.js) ---
function extractHtmlTags(raw) {
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
  const htmlLabeled = raw.match(
    /<b>\s*Order\s*ID\s*<\/b>\s*[:\s]*([^<\n\r\s]+)/i,
  );
  if (htmlLabeled && htmlLabeled[1])
    ids.push({ id: htmlLabeled[1].trim(), confidence: 'high' });
  const plainLabeled = raw.match(/Order\s*ID[:\s]*([0-9]+)/i);
  if (plainLabeled && plainLabeled[1])
    ids.push({ id: plainLabeled[1].trim(), confidence: 'high' });
  const digitMatches = [...new Set(raw.match(/\d{1,12}/g) || [])];
  for (const d of digitMatches) {
    if (ids.find((x) => x.id === d)) continue;
    const conf = d.length >= 6 ? 'medium' : 'low';
    ids.push({ id: d, confidence: conf });
  }
  return ids;
}

function splitByHr(raw) {
  const parts = raw.split(/<hr\s*\/?>(?:\s*)/i);
  if (parts.length > 1) {
    const before = parts.slice(0, parts.length - 1).join('<hr>');
    const after = parts[parts.length - 1];
    return { before, after };
  }
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

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseRawMessage(raw) {
  const bolds = extractHtmlTags(raw);
  const { before, after } = splitByHr(raw);
  const subject = bolds.length > 0 ? bolds[0] : null;
  const orderIds = extractOrderIds(raw);
  let bodyRaw = after && after.trim() ? after : before;
  if (
    subject &&
    bodyRaw.startsWith('<div') &&
    bodyRaw.indexOf(subject) !== -1
  ) {
    bodyRaw = bodyRaw.replace(
      new RegExp(
        `<div[^>]*>\s*<b>\s*${escapeRegExp(subject)}\s*<\\/b>\s*<\\/div>`,
        'i',
      ),
      '',
    );
  }
  bodyRaw = bodyRaw.replace(
    /<div>\s*<b>\s*Order\s*ID\s*<\/b>\s*[:\s]*[^<]*<\/div>/i,
    '',
  );
  const body = stripHtml(bodyRaw);
  const onlyDigits = body.match(/^\d+$/);
  const interpretedOrderIds = [...orderIds];
  if (onlyDigits) {
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

// --- API helpers ---
async function listarTicketsDirect(limite = 100) {
  // enforce API max limit
  if (!limite || limite > 100) limite = 100;
  try {
    const resp = await axios.get(`${TICKET_API_BASE_URL}/tickets`, {
      headers: { 'X-Api-Key': API_KEY },
      params: { limit: limite, sort_by: 'created_at', order: 'desc' },
      timeout: 15000,
    });
    return resp.data?.data?.list || [];
  } catch (err) {
    console.error('Error requesting tickets:', err.toString());
    if (err.response) console.error('Response data:', err.response.data);
    return [];
  }
}

async function buscarTicketDetail(ticketId) {
  try {
    const resp = await axios.get(`${TICKET_API_BASE_URL}/tickets/${ticketId}`, {
      headers: { 'X-Api-Key': API_KEY },
      timeout: 10000,
    });
    return resp.data?.data || resp.data || null;
  } catch (err) {
    console.error(`Error requesting ticket ${ticketId}:`, err.toString());
    if (err.response) console.error('Response data:', err.response.data);
    return null;
  }
}

// --- output files ---
const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const RAW_FILE = path.join(LOG_DIR, 'raw_client_messages.jsonl');
const PARSED_FILE = path.join(LOG_DIR, 'parsed_messages.jsonl');

async function main() {
  try {
    console.log('Listing tickets...');
    const tickets = await listarTicketsDirect(100);
    console.log(`Tickets found: ${tickets.length}`);
    let totalMsgs = 0;
    // open append streams
    const rawStream = fs.createWriteStream(RAW_FILE, { flags: 'w' });
    const parsedStream = fs.createWriteStream(PARSED_FILE, { flags: 'w' });

    for (const ticket of tickets) {
      const full = await buscarTicketDetail(ticket.id);
      if (!full || !Array.isArray(full.messages)) continue;
      for (const [i, msg] of full.messages.entries()) {
        if (!msg || msg.is_staff) continue; // only client messages
        totalMsgs++;
        const rawObj = {
          ticketId: ticket.id,
          messageIndex: i,
          raw: msg.message,
        };
        rawStream.write(JSON.stringify(rawObj) + '\n');
        const parsed = parseRawMessage(msg.message);
        const out = { ticketId: ticket.id, messageIndex: i, ...parsed };
        parsedStream.write(JSON.stringify(out) + '\n');
        // small delay
        await new Promise((r) => setTimeout(r, 60));
      }
    }

    rawStream.end();
    parsedStream.end();
    console.log(`Done. Total client messages: ${totalMsgs}`);
    console.log(`Raw messages saved to: ${RAW_FILE}`);
    console.log(`Parsed messages saved to: ${PARSED_FILE}`);
  } catch (err) {
    console.error('Unexpected error in main:', err);
  }
}

main();

export { parseRawMessage };
