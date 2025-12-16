const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const hasOpenAIKey = () => Boolean(OPENAI_API_KEY && OPENAI_API_KEY.trim());

const buildClient = () => {
  if (!hasOpenAIKey()) {
    const err = new Error('Falta OPENAI_API_KEY');
    err.code = 'NO_OPENAI_KEY';
    throw err;
  }

  return {
    async chat({ system, user, temperature = 0.4 }) {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature,
          messages: [
            ...(system ? [{ role: 'system', content: system }] : []),
            { role: 'user', content: user },
          ],
        }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(`OpenAI error ${resp.status}: ${text}`);
        err.status = resp.status;
        throw err;
      }

      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content;
      return String(content || '').trim();
    },
  };
};

module.exports = {
  hasOpenAIKey,
  buildClient,
};
