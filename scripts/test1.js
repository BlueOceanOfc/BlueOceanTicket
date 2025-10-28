import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

// Try to find a .env file by walking up the directory tree from cwd (max 6 levels)
function findEnvPath() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.resolve(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // fallback to project root relative to this script (one level up)
  return path.resolve(process.cwd(), '..', '.env');
}

const envPath = findEnvPath();
dotenv.config({ path: envPath });

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
    // API returns data.data as the ticket object in other code
    return resp.data?.data || resp.data || null;
  } catch (err) {
    console.error(`Error requesting ticket ${ticketId}:`, err.toString());
    if (err.response) console.error('Response data:', err.response.data);
    return null;
  }
}

async function main() {
  try {
    console.log('Fetching tickets (direct API call)...');
    const tickets = await listarTicketsDirect(50);
    console.log(`Total tickets fetched: ${tickets.length}`);
    if (tickets.length === 0) return;

    for (const ticket of tickets) {
      console.log(
        '------------------------------------------------------------',
      );
      console.log(`Ticket ID: ${ticket.id}`);
      // Fetch full ticket details (including messages) and print raw messages
      const full = await buscarTicketDetail(ticket.id);
      if (!full) {
        console.log('Could not fetch full ticket details for this ticket.');
      } else {
        console.log('Raw full ticket object (exact from API):');
        console.dir(full, { depth: null });

        if (Array.isArray(full.messages) && full.messages.length > 0) {
          for (const [i, msg] of full.messages.entries()) {
            console.log(`\nMessage #${i + 1} (raw):`);
            console.dir(msg, { depth: null });
          }
        } else {
          console.log(
            'No messages array found on this full ticket object or it is empty.',
          );
        }
      }

      // small delay to avoid hammering the API
      await new Promise((r) => setTimeout(r, 120));
    }
  } catch (error) {
    console.error('Unexpected error while fetching tickets:', error);
    process.exitCode = 1;
  }
}

main();
