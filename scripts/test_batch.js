import { buscarStatusPedidosConcurrently } from '../services/apiService.js';

(async () => {
  try {
    const ids = Array.from({ length: 8 }, (_, i) => String(i + 1));
    console.log('Running batch lookup for ids:', ids.join(', '));
    const res = await buscarStatusPedidosConcurrently(ids, { concurrency: 3, attempts: 1, perTicketLimit: 100 });
    console.log('Batch result summary:', { found: res.found.length, notFound: res.notFound.length, tooMany: res.tooMany });
  } catch (err) {
    console.error('Error running batch test:', err.message);
  }
})();
