const removerTagsHTML = (html) => {
  return html.replace(/<\/?[^>]+(>|$)/g, ''); // Remove tags HTML simples
};

function cortarMensagemUtil(mensagemOriginal) {
  console.log(`📜 Mensagem original: "${mensagemOriginal}"`);

  // Manter as tags HTML para cortar baseado nelas
  const mensagemComTags = mensagemOriginal;

  // Logando a string completa
  console.log(`🔧 Mensagem com tags: "${mensagemComTags}"`);

  // Buscar a posição da primeira tag </b> (após "Pedido - Refil e Garantia")
  const primeiraTagFechamento = mensagemComTags.indexOf('</b>');
  console.log(`📌 Primeira tag </b> encontrada em: ${primeiraTagFechamento}`);

  if (primeiraTagFechamento !== -1) {
    // Cortar a mensagem após a primeira tag </b> (onde começa o ID do Pedido)
    const cortadaComTags = mensagemComTags
      .slice(primeiraTagFechamento + 4) // Pula o </b> com +4
      .trim(); // +4 para pular o </b>
    console.log(
      `⚡ Mensagem cortada após primeira tag </b>: "${cortadaComTags}"`,
    );

    // Agora, remover as tags HTML para deixar apenas a parte útil da mensagem
    let cortadaSemTags = removerTagsHTML(cortadaComTags).trim();
    console.log(`🔧 Mensagem sem tags HTML: "${cortadaSemTags}"`);

    // Agora, precisamos extrair o número do pedido de uma maneira mais precisa
    const regexOrderId = /(\d{4,})/; // Captura qualquer número com 4 ou mais dígitos
    const match = cortadaSemTags.match(regexOrderId);

    if (match) {
      // Se o número do pedido for encontrado, substituir o texto pelo número do pedido
      cortadaSemTags =
        match[1] + cortadaSemTags.slice(match.index + match[0].length); // Concatena o número do pedido com o restante do texto
    } else {
      // Se não encontrar o número do pedido, apenas remove o "ID Do Pedido:" do texto
      cortadaSemTags = cortadaSemTags.replace(/ID Do Pedido:/i, '').trim();
    }

    console.log(`🔧 Mensagem cortada (final): "${cortadaSemTags}"`);

    return { completa: mensagemComTags, util: cortadaSemTags };
  }

  // Caso não encontre a tag </b>, tenta retornar a mensagem original
  console.log(`⚡ Mensagem não cortada corretamente, retornando a original.`);
  return { completa: mensagemComTags, util: mensagemOriginal };
}

// Teste com uma mensagem de exemplo
const mensagemTeste =
  '<div><b>Pedido - Refil e Garantia</b></div><div><b>ID Do Pedido</b>: 1875</div><hr>acelere meu pedido';
const resultado = cortarMensagemUtil(mensagemTeste);
console.log('🔧 Resultado final:', resultado);
