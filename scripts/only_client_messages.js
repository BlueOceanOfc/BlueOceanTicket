import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

// procura .env subindo até 6 níveis
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

async function listarTicketsDirect(limite = 50) {
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

async function main() {
  try {
    const tickets = await listarTicketsDirect(100);
    if (!tickets || tickets.length === 0) {
      console.log('No tickets.');
      return;
    }

    for (const ticket of tickets) {
      const full = await buscarTicketDetail(ticket.id);
      if (!full || !Array.isArray(full.messages)) continue;

      for (const msg of full.messages) {
        // print only client messages (is_staff === false)
        if (!msg.is_staff) {
          // Print raw message exactly as returned, then a blank line
          console.log(msg.message);
          console.log('');
        }
      }

      // small delay
      await new Promise((r) => setTimeout(r, 80));
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

main();
