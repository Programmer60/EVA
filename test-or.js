const models = [
  'google/gemini-2.0-pro-exp-02-05:free',
  'google/gemini-2.0-flash-lite-preview-02-05:free',
  'meta-llama/llama-3-8b-instruct:free',
  'microsoft/phi-3-mini-128k-instruct:free',
  'openchat/openchat-7b:free',
  'gryphe/mythomax-l2-13b:free',
  'undi95/toppy-m-7b:free',
  'mistralai/mistral-7b-instruct:free'
];

async function testModels() {
  for (const model of models) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer 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',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: 'hello' }]
        })
      });
      const data = await res.json();
      console.log(model, res.status, data.error ? data.error.message : 'SUCCESS');
    } catch (e) {
      console.log(model, 'FETCH ERROR', e.message);
    }
  }
}
testModels();
