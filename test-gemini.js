const { GoogleGenAI } = require('@google/genai');
const client = new GoogleGenAI({ apiKey: 'AIzaSyDncpTD8ZEYP_PaDkE8lkQrL6kDR1uVi18' });
client.models.generateContent({
  model: 'gemini-2.0-flash-lite-preview-02-05',
  contents: 'hello',
}).then(res => console.log('SUCCESS:', res.text)).catch(err => console.error('ERROR:', err));
