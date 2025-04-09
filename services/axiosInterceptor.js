const axios = require('axios');
const path = require('path');

// Intercepta requisições e respostas feitas para OpenAI
axios.interceptors.response.use(
  async (response) => {
    const isOpenAI = response.config?.url?.includes('openai.com');
    const usage = response.data?.usage;

    if (isOpenAI && usage) {
      const { prompt_tokens, completion_tokens, total_tokens } = usage;

      // Descobrir de onde veio a chamada
      const trace = new Error().stack
        .split('\n')
        .slice(2)
        .find((line) => line.includes('at '));

      const cleanTrace = trace
        ? trace.trim().replace(/^at\s+/g, '')
        : 'Origem desconhecida';
      const relativePath = cleanTrace.includes(process.cwd())
        ? cleanTrace.replace(process.cwd(), '.')
        : cleanTrace;

      //console.log('\n📊 Detalhes do uso da OpenAI:');
      // console.log(`📁 Origem: ${relativePath}`);
      //console.log(`📥 Prompt tokens: ${prompt_tokens}`);
      // console.log(`📤 Resposta tokens: ${completion_tokens}`);
      //console.log(`🧮 Total tokens: ${total_tokens}\n`);
    }

    return response;
  },
  (error) => {
    // Também capturamos erros da OpenAI para mostrar de onde vieram
    const isOpenAI = error.config?.url?.includes('openai.com');
    if (isOpenAI) {
      console.log('❌ Erro ao chamar OpenAI:', error.message);

      const trace = new Error().stack
        .split('\n')
        .slice(2)
        .find((line) => line.includes('at '));

      const cleanTrace = trace
        ? trace.trim().replace(/^at\s+/g, '')
        : 'Origem desconhecida';
      const relativePath = cleanTrace.includes(process.cwd())
        ? cleanTrace.replace(process.cwd(), '.')
        : cleanTrace;

      console.log(`📁 Origem do erro: ${relativePath}\n`);
    }

    return Promise.reject(error);
  },
);
