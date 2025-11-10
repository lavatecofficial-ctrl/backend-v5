const WebSocket = require('ws');

console.log('🔌 Intentando conectar a 888starz...');

const ws = new WebSocket('wss://eu-central-1-game9.spribegaming.com/BlueBox/websocket', [], {
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'Origin': 'https://888starz.bet'
  }
});

ws.on('open', () => {
  console.log('✅ Conexión abierta!');
  
  const handshake = {
    c: 0,
    a: 0,
    p: {
      api: '1.8.4',
      cl: 'Node.js'
    }
  };
  
  console.log('📤 Enviando handshake:', JSON.stringify(handshake));
  ws.send(JSON.stringify(handshake));
  console.log('⏳ Esperando respuesta...');
});

ws.on('message', (data) => {
  console.log('📥 Mensaje recibido:', data.toString());
  
  try {
    const obj = JSON.parse(data.toString());
    console.log('📦 Mensaje parseado:', JSON.stringify(obj, null, 2));
  } catch (e) {
    console.log('❌ Error parseando:', e.message);
  }
});

ws.on('error', (error) => {
  console.log('❌ Error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log(`🔴 Conexión cerrada - Code: ${code}, Reason: ${reason.toString() || 'Sin razón'}`);
  process.exit(0);
});

// Timeout de 30 segundos
setTimeout(() => {
  console.log('⏱️ Timeout - cerrando conexión');
  ws.close();
}, 30000);
