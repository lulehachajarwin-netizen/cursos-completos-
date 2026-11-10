// Chatbot MEGA PACK - WhatsApp Cloud API (Meta) + Gemini
// Uso con el NÚMERO DE PRUEBA de Meta. No uses tu +51931637348 real
// hasta migrarlo, porque ese número ya está activo en la app del celular.
//
// Pasos:
// 1. cp .env.example .env  y rellena tus datos (ver README.md)
// 2. npm install
// 3. npm start
// 4. Sube a Render/Railway y pon la URL pública en Meta > WhatsApp > Configuración > Webhook
// 5. Prueba escribiendo al número de prueba desde un número que agregaste como destinatario de prueba en Meta.

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'mega-pack-verifica-123';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Prompt del vendedor (Gemini actúa como experto en ventas)
// Si system-prompt.md no está en el repo, usa un prompt básico para no tumbar el deploy
let SYSTEM_PROMPT;
try {
  SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, 'system-prompt.md'), 'utf8');
} catch (e) {
  console.log('system-prompt.md no encontrado, usando prompt básico');
  SYSTEM_PROMPT = 'Eres el vendedor experto de MEGA PACK en WhatsApp. Vendes 162 cursos en 13 packs. Precio individual S/ 5-15 de lista, con descuentos 30%, 40% y 50%, precio final S/ 2.50-10.50. Catálogo completo opcional por S/ 200. Solo das información, no das el contenido del curso ni links de Drive. Respuestas cortas en español.';
}

// Memoria simple por número de cliente (se borra al reiniciar el servidor)
// Para producción usa una base de datos.
const histories = new Map(); // phone -> [{role, text}]

function getHistory(phone) {
  if (!histories.has(phone)) histories.set(phone, []);
  return histories.get(phone);
}

// --- 1. Verificación del webhook (Meta) ---
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado por Meta');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- 2. Recibir mensajes de WhatsApp ---
app.post('/webhook', async (req, res) => {
  // Responder rápido a Meta para que no reintente
  res.sendStatus(200);

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    if (!message || message.type !== 'text') return;

    const from = message.from; // número del cliente
    const text = message.text.body;
    console.log(`Mensaje de ${from}: ${text}`);

    // Guardar en historial (máximo 10 mensajes)
    const history = getHistory(from);
    history.push({ role: 'user', text });
    if (history.length > 20) history.splice(0, history.length - 20);

    const reply = await askGemini(history);
    history.push({ role: 'assistant', text: reply });

    await sendWhatsApp(from, reply);
  } catch (err) {
    console.error('Error en webhook:', err.message);
  }
});

// --- 3. Preguntar a Gemini ---
async function askGemini(history) {
  if (!GEMINI_API_KEY) {
    return 'Hola 👋 Soy el asistente de MEGA PACK. ¿Qué curso te interesa? Tenemos 162 cursos desde S/ 2.50, o el catálogo completo por S/ 200.';
  }

  const contents = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));

  // Google cambia los modelos seguido (2.0 -> 3.0 -> 2.5 -> 3.8), prueba en orden hasta que uno funcione
  const models = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-3.0-flash'];
  for (const model of models) {
    for (const apiVersion of ['v1beta', 'v1']) {
      try {
        const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 400 },
          }),
        });
        if (r.ok) {
          const data = await r.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return text;
        } else {
          console.error(`Gemini error ${model} ${apiVersion}:`, r.status, await r.text());
        }
      } catch (e) {
        console.error(`Gemini error ${model} ${apiVersion}:`, e.message);
      }
    }
  }
  console.error('Gemini: ningún modelo funcionó, usando respuesta de respaldo');
  return '¡Hola! 👋 ¿Qué curso te interesa? Te ayudo con el precio con descuento. Si quieres, dime el curso y te lo confirmo.';
}

// --- 4. Enviar por WhatsApp Cloud API ---
async function sendWhatsApp(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.log(`[MODO PRUEBA - sin token] Para ${to}: ${text}`);
    return;
  }
  const url = `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });
  if (!r.ok) console.error('WhatsApp send error:', r.status, await r.text());
  else console.log(`Enviado a ${to}`);
}

app.get('/', (req, res) => res.send('Chatbot MEGA PACK activo. Usa /webhook para Meta.'));

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
  console.log('Recuerda: usa el NÚMERO DE PRUEBA de Meta, no tu número real todavía.');
});
