async function testAllFreeModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  const data = await res.json();
  const freeModels = data.data.filter(m => m.pricing.prompt === "0").map(m => m.id);
  
  console.log('Found ' + freeModels.length + ' free models. Testing...');
  
  for (const model of freeModels) {
    try {
      const chatRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
      if (chatRes.ok) {
        console.log('? WORKED: ' + model);
        return; // found one!
      } else {
        const text = await chatRes.text();
        console.log('? FAILED: ' + model + ' ' + chatRes.status + ' ' + text.substring(0, 50));
      }
    } catch (e) {
      console.log('ERROR ' + model);
    }
  }
}
testAllFreeModels();
