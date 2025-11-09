# Sistema de Eventos en Tiempo Real - Spaceman

## 🔌 Conexión WebSocket

### Namespace
```javascript
const socket = io('http://localhost:3000/spaceman', {
  transports: ['websocket'],
  withCredentials: true
});
```

## 📡 Eventos del Cliente al Servidor

### 1. Unirse a una sala de Spaceman
```javascript
socket.emit('join_spaceman', { 
  spacemanId: 1  // ID del bookmaker o spaceman
});
```

**Respuesta:**
```javascript
socket.on('spaceman_joined', (data) => {
  console.log('Conectado a Spaceman:', data);
  // data.data.latestRounds - Últimas 100 rondas
  // data.data.stats - Estadísticas generales
  // data.data.connectionStatus - Estado de conexiones WS
});
```

### 2. Salir de una sala
```javascript
socket.emit('leave_spaceman', { spacemanId: 1 });
```

### 3. Obtener estadísticas
```javascript
socket.emit('get_spaceman_stats', { spacemanId: 1 });

socket.on('spaceman_stats', (data) => {
  console.log('Estadísticas:', data.data);
});
```

### 4. Obtener últimas rondas
```javascript
socket.emit('get_latest_rounds', { 
  spacemanId: 1, 
  limit: 50 
});

socket.on('latest_rounds', (data) => {
  console.log('Últimas rondas:', data.data);
});
```

## 📊 Eventos del Servidor al Cliente (Tiempo Real)

### 1. Nueva Ronda Guardada (Para Gráfico)
```javascript
socket.on('newRound', (roundData) => {
  console.log('Nueva ronda guardada:', roundData);
  
  // Estructura de roundData:
  {
    id: 123,
    game_id: "10090950012",
    max_multiplier: 52.21,
    bets_count: 1938,
    total_bet_amount: 2668.03,
    online_player: 2007,
    total_cashout: 15720.01,
    casino_profit: -13051.98,
    created_at: "2025-11-09T06:36:52.000Z"
  }
  
  // AGREGAR AL GRÁFICO:
  addPointToChart({
    x: new Date(roundData.created_at),
    y: roundData.max_multiplier
  });
});
```

### 2. Datos de Ronda en Progreso
```javascript
socket.on('round', (roundData) => {
  console.log('Datos de ronda actual:', roundData);
  
  // Estructura:
  {
    game_id: "10090950012",
    bets_count: 1938,
    total_bet_amount: 2668.03,
    online_player: 2007,
    total_cashout: 15720.01,
    casino_profit: -13051.98
  }
  
  // ACTUALIZAR ESTADÍSTICAS EN TIEMPO REAL
  updateStats(roundData);
});
```

### 3. Multiplicador en Vivo
```javascript
socket.on('liveMultiplier', (data) => {
  console.log('Multiplicador en vivo:', data);
  
  // Estructura:
  {
    gameId: "10090950012",
    multiplier: 2.50
  }
  
  // MOSTRAR MULTIPLICADOR EN TIEMPO REAL
  displayLiveMultiplier(data.multiplier);
});
```

### 4. Timer (Countdown)
```javascript
socket.on('timer', (data) => {
  console.log('Timer:', data);
  
  // Estructura:
  {
    gameId: "10090950012",
    message: "PRÓXIMO JUEGO EN 10s"
  }
  
  // MOSTRAR COUNTDOWN
  displayCountdown(data.message);
});
```

### 5. Predicción
```javascript
socket.on('prediction', (predictionData) => {
  console.log('Predicción generada:', predictionData);
  
  // Mostrar predicción en UI
  displayPrediction(predictionData);
});
```

### 6. Lista de Spacemen Disponibles
```javascript
socket.on('spacemen_list', (data) => {
  console.log('Spacemen disponibles:', data.data);
});
```

### 7. Estado de Conexiones
```javascript
socket.on('connections_status', (data) => {
  console.log('Estado de conexiones:', data.data);
  
  // Estructura:
  {
    "1_multiplier": { status: "CONNECTED", retryCount: 0 },
    "1_finance": { status: "CONNECTED", retryCount: 0 }
  }
});
```

### 8. Errores
```javascript
socket.on('error', (error) => {
  console.error('Error:', error.message);
});
```

## 🎯 Ejemplo Completo de Implementación

```javascript
import { io } from 'socket.io-client';

// 1. Conectar al servidor
const socket = io('http://localhost:3000/spaceman', {
  transports: ['websocket'],
  withCredentials: true
});

// 2. Cuando se conecta
socket.on('connect', () => {
  console.log('Conectado al servidor Spaceman');
  
  // Unirse a la sala del Spaceman ID 1
  socket.emit('join_spaceman', { spacemanId: 1 });
});

// 3. Recibir datos iniciales
socket.on('spaceman_joined', (data) => {
  console.log('Datos iniciales:', data.data);
  
  // Cargar rondas históricas en el gráfico
  const rounds = data.data.latestRounds;
  rounds.forEach(round => {
    addPointToChart({
      x: new Date(round.created_at),
      y: round.max_multiplier
    });
  });
  
  // Mostrar estadísticas
  updateStats(data.data.stats);
});

// 4. Escuchar nuevas rondas (ACTUALIZACIÓN EN TIEMPO REAL)
socket.on('newRound', (roundData) => {
  console.log('🆕 Nueva ronda:', roundData);
  
  // Agregar punto al gráfico
  addPointToChart({
    x: new Date(roundData.created_at),
    y: roundData.max_multiplier
  });
  
  // Actualizar estadísticas
  updateStats({
    total_rounds: '+1',
    avg_multiplier: 'recalcular',
    max_multiplier: Math.max(currentMax, roundData.max_multiplier)
  });
  
  // Mostrar notificación
  showNotification(`Nuevo resultado: ${roundData.max_multiplier}x`);
});

// 5. Multiplicador en vivo
socket.on('liveMultiplier', (data) => {
  console.log('🚀 Multiplicador:', data.multiplier);
  
  // Actualizar display del multiplicador
  document.getElementById('live-multiplier').textContent = `${data.multiplier}x`;
});

// 6. Timer
socket.on('timer', (data) => {
  console.log('⏱️ Timer:', data.message);
  
  // Mostrar countdown
  document.getElementById('countdown').textContent = data.message;
});

// 7. Predicción
socket.on('prediction', (predictionData) => {
  console.log('🔮 Predicción:', predictionData);
  
  // Mostrar predicción en UI
  displayPrediction(predictionData);
});

// 8. Datos de ronda en progreso
socket.on('round', (roundData) => {
  console.log('📊 Ronda en progreso:', roundData);
  
  // Actualizar estadísticas en tiempo real
  document.getElementById('bets-count').textContent = roundData.bets_count;
  document.getElementById('total-bet').textContent = roundData.total_bet_amount;
  document.getElementById('online-players').textContent = roundData.online_player;
});

// 9. Manejo de errores
socket.on('error', (error) => {
  console.error('❌ Error:', error.message);
  showErrorNotification(error.message);
});

// 10. Desconexión
socket.on('disconnect', () => {
  console.log('Desconectado del servidor');
});
```

## 📈 Actualización del Gráfico

### Opción 1: Chart.js
```javascript
let chart;

function initChart(historicalData) {
  const ctx = document.getElementById('spacemanChart').getContext('2d');
  
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'Multiplicador',
        data: historicalData.map(round => ({
          x: new Date(round.created_at),
          y: round.max_multiplier
        })),
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1
      }]
    },
    options: {
      scales: {
        x: {
          type: 'time',
          time: {
            unit: 'minute'
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Multiplicador'
          }
        }
      }
    }
  });
}

function addPointToChart(point) {
  if (chart) {
    chart.data.datasets[0].data.push(point);
    
    // Mantener solo los últimos 100 puntos
    if (chart.data.datasets[0].data.length > 100) {
      chart.data.datasets[0].data.shift();
    }
    
    chart.update('none'); // Actualizar sin animación para mejor rendimiento
  }
}

// Inicializar cuando se reciben datos
socket.on('spaceman_joined', (data) => {
  initChart(data.data.latestRounds);
});

// Agregar puntos en tiempo real
socket.on('newRound', (roundData) => {
  addPointToChart({
    x: new Date(roundData.created_at),
    y: roundData.max_multiplier
  });
});
```

## 🔄 Flujo Completo

1. **Frontend se conecta** → `socket.connect()`
2. **Frontend se une a sala** → `socket.emit('join_spaceman', { spacemanId: 1 })`
3. **Backend envía datos iniciales** → `socket.on('spaceman_joined')` con últimas 100 rondas
4. **Frontend carga gráfico** con datos históricos
5. **Backend detecta nueva ronda** → Guarda en BD
6. **Backend emite evento** → `socket.emit('newRound', roundData)`
7. **Frontend recibe evento** → `socket.on('newRound')`
8. **Frontend actualiza gráfico** → Agrega nuevo punto
9. **Ciclo se repite** para cada nueva ronda

## 🎨 Eventos Visuales Sugeridos

- **newRound**: Agregar punto al gráfico + animación
- **liveMultiplier**: Actualizar número grande en pantalla
- **timer**: Mostrar countdown
- **round**: Actualizar estadísticas en tiempo real
- **prediction**: Mostrar predicción con animación

## ⚠️ Notas Importantes

1. **El evento `newRound` es el más importante** para actualizar el gráfico
2. **Usa `spaceman_joined`** para cargar datos históricos al inicio
3. **El `spacemanId`** puede ser el ID del bookmaker o el ID directo del spaceman
4. **Los eventos se emiten a la sala** `spaceman:${spacemanId}`
5. **Mantén la conexión abierta** para recibir actualizaciones en tiempo real

## 🐛 Debugging

```javascript
// Ver todos los eventos
socket.onAny((eventName, ...args) => {
  console.log(`Evento recibido: ${eventName}`, args);
});

// Ver estado de conexión
console.log('Conectado:', socket.connected);
console.log('ID:', socket.id);
```
