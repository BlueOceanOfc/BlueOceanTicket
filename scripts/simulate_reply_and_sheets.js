import { gerarRespostaFinal } from '../services/iaSolicitacao.js';
import { registrarNoGoogleSheets, flushPendingWrites } from '../services/sheetsService.js';

(async function(){
  // Simulate scenario: some found, some notFound
  const ticketId = 999;
  const tipoSolicitacao = 'Aceleração';
  const foundIds = ['2','3','4'];
  const orderDataList = [
    { orderId: '2', user: 'alice', status: 'complete' },
    { orderId: '3', user: 'alice', status: 'canceled' },
    { orderId: '4', user: 'alice', status: 'pending' },
  ];
  const idioma = 'en';
  const notFound = ['1','5','6'];

  const reply = await gerarRespostaFinal(ticketId, tipoSolicitacao, foundIds, orderDataList, idioma, { notFoundIds: notFound });
  console.log('--- Generated Reply ---');
  console.log(reply);

  // Test sheets buffering (will not perform network until flushPendingWrites)
  registrarNoGoogleSheets({ orderId: '2', mensagemDoCliente: 'test' });
  registrarNoGoogleSheets({ orderId: '3', mensagemDoCliente: 'test' });
  registrarNoGoogleSheets({ orderId: '2', mensagemDoCliente: 'test duplicate' });

  console.log('Buffered writes queued. Now flushing (this will attempt to contact Google Sheets if configured).');
  // We won't actually flush to remote in automated test by default; comment out in CI.
  try {
    await flushPendingWrites();
    console.log('Flush complete');
  } catch (e) {
    console.error('Flush error (this may be expected if no credentials are configured):', e.message);
  }
})();