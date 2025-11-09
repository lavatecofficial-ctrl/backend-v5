import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { seedBookmakers } from './scripts/seed-bookmakers';
import { seedGames } from './scripts/seed-games';
import { getDataSourceToken } from '@nestjs/typeorm';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  const configService = app.get(ConfigService);
  
  // Configurar adaptador de Socket.IO
  app.useWebSocketAdapter(new IoAdapter(app));
  
  // Configurar CORS
  const frontendUrl = configService.get('FRONTEND_URL') || 'http://localhost:3000';
  const frontendUrls = frontendUrl.split(',').map(url => url.trim());
  const backendPort = configService.get('PORT') || 3001;
  
  app.enableCors({
    origin: [...frontendUrls, `http://localhost:${backendPort}`],
    credentials: true,
  });

  // Configurar validación global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Configurar prefijo global
  app.setGlobalPrefix('api');

  const port = configService.get('PORT') || 3001;
  await app.listen(port);
  
  // Ejecutar seeding
  const dataSource = app.get(getDataSourceToken());
  await seedGames(dataSource);
  await seedBookmakers(dataSource);
  
  console.log(`🚀 Aplicación ejecutándose en: http://localhost:${port}`);
  console.log(`📚 Documentación API: http://localhost:${port}/api`);
  console.log(`🎮 Servicios WebSocket disponibles para iniciar manualmente`);
}
bootstrap();
