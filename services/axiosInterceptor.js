import axios from 'axios';
import path from 'path';
import { logger } from '../logger.js';

function getOriginFromStack() {
  const trace = new Error().stack
    .split('\n')
    .slice(2)
    .find((line) => line.includes('at '));
  const cleanTrace = trace
    ? trace.trim().replace(/^at\s+/g, '')
    : 'Origem desconhecida';
  return cleanTrace.includes(process.cwd())
    ? cleanTrace.replace(process.cwd(), '.')
    : cleanTrace;
}

axios.interceptors.response.use(
  async (response) => {
    const isOpenAI = response.config?.url?.includes('openai.com');
    const usage = response.data?.usage;

    if (isOpenAI && usage) {
      const { prompt_tokens, completion_tokens, total_tokens } = usage;
      const origin = getOriginFromStack();
      // logger.info(`📊 OpenAI usage | Origem: ${origin} | Prompt: ${prompt_tokens} | Resposta: ${completion_tokens} | Total: ${total_tokens}`);
    }
    return response;
  },
  (error) => {
    const isOpenAI = error.config?.url?.includes('openai.com');
    if (isOpenAI) {
      const origin = getOriginFromStack();
      logger.error(
        `❌ Erro ao chamar OpenAI: ${error.message} | Origem: ${origin}`,
      );
    }
    return Promise.reject(error);
  },
);
