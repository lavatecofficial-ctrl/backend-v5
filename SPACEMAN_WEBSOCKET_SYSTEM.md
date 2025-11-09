# Sistema de Conexión WebSocket para Spaceman

## 📋 Descripción General

Sistema optimizado para conectarse a los WebSockets de Pragmatic Play Live para el juego Spaceman. Maneja dos conexiones simultáneas:

1. **Broadcaster** - Multiplicador en tiempo real
2. **Finance (gsXX)** - Datos financieros y estadísticas

## 🗄️ Estructura de la Base de Datos

### Tabla: `spaceman_ws`

```sql
CREATE TABLE spaceman_ws (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL,
  bookmaker_id INTEGER NOT NULL,
  
  -- URLs base (sin el JSESSIONID)
  broadcaster_base VARCHAR(255),  -- wss://broadcaster.pragmaticplaylive.net/broadcast?
  finance_base VARCHAR(255),      -- wss://gs12.pragmaticplaylive.net/game?bcs=true&
  
  -- Token de sesión
  jsessionid TEXT,                -- Token completo que se concatena a las URLs
  token_updated_at TIMESTAMP,     -- Última actualización del token
  
  -- Headers personalizados en formato JSONB
  headers JSONB,                  -- Headers HTTP para las conexiones
  
  -- Estado de conexión
  status_ws VARCHAR(20) DEFAULT 'DISCONNECTED',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign keys
  CONSTRAINT fk_game FOREIGN KEY (game_id) REFERENCES games(id),
  CONSTRAINT fk_bookmaker FOREIGN KEY (bookmaker_id) REFERENCES bookmakers(id)
);
```

### Estructura de Headers (JSONB)

```json
{
  "broadcaster": {
    "Host": "broadcaster.pragmaticplaylive.net",
    "Connection": "Upgrade",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
    "Upgrade": "websocket",
    "Origin": "https://client.pragmaticplaylive.net",
    "Sec-WebSocket-Version": "13",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "es-419,es;q=0.9",
    "Sec-GPC": "1",
    "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits"
  },
  "finance": {
    "Host": "gs12.pragmaticplaylive.net",
    "Connection": "Upgrade",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
    "Upgrade": "websocket",
    "Origin": "https://client.pragmaticplaylive.net",
    "Sec-WebSocket-Version": "13",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "es-419,es;q=0.9",
    "Sec-GPC": "1",
    "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits"
  }
}
```

## 🔌 Conexiones WebSocket

### URL Broadcaster (Multiplicador)
```
wss://broadcaster.pragmaticplaylive.net/broadcast?JSESSIONID=xxx&tableId=xxx
```

### URL Finance (Datos Financieros)
```
wss://gs12.pragmaticplaylive.net/game?bcs=true&JSESSIONID=xxx&tableId=xxx
```

## 🚀 Endpoints API

### 1. Iniciar Servicio
```http
POST /spaceman/start
```
Inicia todas las conexiones WebSocket y actualiza tokens.

**Respuesta:**
```json
{
  "success": true,
  "message": "Servicio de Spaceman iniciado exitosamente con tokens actualizados",
  "data": {
    "timestamp": "2025-11-09T06:30:00.000Z",
    "connectionsStatus": {
      "1_multiplier": { "status": "CONNECTED", "retryCount": 0 },
      "1_finance": { "status": "CONNECTED", "retryCount": 0 }
    }
  }
}
```

### 2. Ver Estado del Servicio
```http
GET /spaceman/status
```
Obtiene el estado actual de todas las conexiones.

**Respuesta:**
```json
{
  "success": true,
  "message": "Estado de Spaceman obtenido exitosamente",
  "data": {
    "isActive": true,
    "activeConnections": 2,
    "totalSpaceman": 2,
    "connectionsStatus": {
      "1_multiplier": { "status": "CONNECTED", "retryCount": 0 },
      "1_finance": { "status": "CONNECTED", "retryCount": 0 }
    },
    "timestamp": "2025-11-09T06:30:00.000Z",
    "lastTokenUpdate": "2025-11-09T01:08:54.540Z",
    "sessionUrl": null
  }
}
```

### 3. Actualizar Headers
```http
PATCH /spaceman/:id/headers
Content-Type: application/json

{
  "headers": {
    "broadcaster": {
      "Host": "broadcaster.pragmaticplaylive.net",
      "User-Agent": "Mozilla/5.0...",
      ...
    },
    "finance": {
      "Host": "gs12.pragmaticplaylive.net",
      "User-Agent": "Mozilla/5.0...",
      ...
    }
  }
}
```

### 4. Actualizar URL de Sesión
```http
PATCH /spaceman/session-url
Content-Type: application/json

{
  "url": "https://nueva-url-de-sesion.com"
}
```

## 📊 Mensajes WebSocket Procesados

### 1. Multiplicador en Vivo
```xml
<sm_mul gId="game123" mul="2.50" seq="1"></sm_mul>
```
Emite al frontend: `liveMultiplier` con el multiplicador actual.

### 2. Timer
```xml
<timer id="game123" seconds="10">10</timer>
```
Inicia countdown para próximo juego.

### 3. Leaderboard
```xml
<sm_lb tba="1000" gId="game123" pCount="50" tId="table1" seq="1">
  <user cCode="COP" rType="B" bAmt="1000"/>
  <user cCode="EUR" rType="W" eWinAmt="5.5"/>
</sm_lb>
```
Procesa apuestas y ganancias, calcula profit del casino.

### 4. Estadísticas
```xml
<SpaceManStatisticHistory seq="1">
  {"history": [{"gameId": "game123", "betCount": 10, "playerCount": 50}]}
</SpaceManStatisticHistory>
```

### 5. Resultado del Juego
```xml
<gr result="3.45" gId="game123" seq="1"></gr>
```
Guarda la ronda en BD y dispara predicción.

### 6. Sesión Offline
```xml
<session>offline</session>
```
Reconexión automática con actualización de token.

## 🔄 Sistema de Reconexión

### Características:
- **Backoff exponencial**: Delay aumenta con cada intento fallido
- **Máximo de reintentos**: 3 por defecto (configurable en BD)
- **Reconexión automática**: Solo si el bookmaker está activo
- **Actualización de token**: Automática en caso de sesión offline

### Flujo de Reconexión:
1. Detecta desconexión (código != 1000)
2. Verifica si bookmaker está activo
3. Incrementa contador de reintentos
4. Aplica delay (5s * multiplicador)
5. Actualiza token si es necesario
6. Intenta reconectar

## 🔧 Características Técnicas

### Headers Dinámicos
- Se extraen de la BD (campo `headers`)
- El `Host` se extrae automáticamente de la URL
- El `Sec-WebSocket-Key` se genera en cada conexión
- Fallback a headers por defecto si no existen en BD

### Ping/Pong
- Ping cada 10 segundos
- Sincronizado con el reloj del sistema
- Loguea en archivos separados (multiplier y finance)

### Logs
- `spaceman_finance.log` - Todos los mensajes de finance
- `spaceman_multiplier.log` - Todos los mensajes de multiplicador
- `spaceman-YYYY-MM-DD.log` - Log general con Winston
- `spaceman-error-YYYY-MM-DD.log` - Solo errores

## 📝 Ejemplo de Uso

### 1. Insertar Configuración Inicial
```sql
INSERT INTO spaceman_ws (
  game_id, 
  bookmaker_id, 
  broadcaster_base, 
  finance_base, 
  jsessionid,
  headers
) VALUES (
  2, 
  9,
  'wss://broadcaster.pragmaticplaylive.net/broadcast?',
  'wss://gs12.pragmaticplaylive.net/game?bcs=true&',
  'JSESSIONID=fPlnRtIYbhta67qFrtuoBgs-bbBbXPIMsZWloIluomgYZKSqvMAk%21348714590-13e239b8&tableId=spacemanyxe123nh',
  '{"broadcaster": {...}, "finance": {...}}'::jsonb
);
```

### 2. Iniciar Servicio
```bash
curl -X POST http://localhost:3000/spaceman/start
```

### 3. Ver Estado
```bash
curl http://localhost:3000/spaceman/status
```

### 4. Actualizar Token (cuando expire)
```sql
UPDATE spaceman_ws 
SET jsessionid = 'JSESSIONID=nuevo_token&tableId=xxx',
    token_updated_at = CURRENT_TIMESTAMP
WHERE id = 1;
```

Luego reiniciar el servicio:
```bash
curl -X POST http://localhost:3000/spaceman/start
```

## ⚠️ Consideraciones Importantes

1. **Token Expiration**: El JSESSIONID expira periódicamente, debes actualizarlo manualmente
2. **Server Changes**: Si Pragmatic cambia de gsXX, actualiza `finance_base` en BD
3. **Headers**: Mantén los headers actualizados según los requerimientos de Pragmatic
4. **Bookmaker Status**: Las conexiones solo se mantienen si el bookmaker está activo
5. **Logs**: Revisa los logs regularmente para detectar problemas

## 🎯 Próximas Mejoras Sugeridas

- [ ] Sistema automático de renovación de tokens
- [ ] Detección y manejo del mensaje `<switch>` para cambios de servidor
- [ ] Dashboard en tiempo real de métricas de conexión
- [ ] Alertas automáticas por desconexiones prolongadas
- [ ] Pool de conexiones para balanceo de carga
- [ ] Sistema de caché para reducir latencia

## 📞 Soporte

Para problemas o dudas, revisa:
1. Logs en `backend/logs/`
2. Estado del servicio: `GET /spaceman/status`
3. Verifica que el bookmaker esté activo en BD
4. Confirma que el JSESSIONID sea válido
