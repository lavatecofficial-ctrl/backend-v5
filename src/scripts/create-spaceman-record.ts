import { DataSource } from 'typeorm';
import { Spaceman } from '../entities/spaceman.entity';

export async function createSpacemanRecord(dataSource: DataSource) {
  const spacemanRepository = dataSource.getRepository(Spaceman);

  // Verificar si ya existe un registro para el bookmaker activo (ID 1)
  const existingSpaceman = await spacemanRepository.findOne({
    where: { bookmakerId: 1 }
  });

  if (existingSpaceman) {
    console.log('Spaceman record already exists for bookmaker ID 1, skipping...');
    return existingSpaceman;
  }

  // Crear el registro de Spaceman
  const spacemanData = {
    gameId: 2, // ID del juego Spaceman
    bookmakerId: 1, // ID del bookmaker activo (888Starz)
    urlSessionid: 'https://example.com/session', // URL de ejemplo
    jsessionid: 'jsessionid_example',
    broadcasterBase: 'wss://broadcaster.pragmaticplaylive.net/websocket/real',
    financeBase: 'wss://gs9.pragmaticplaylive.net/websocket/finance_real',
    tokenUpdatedAt: new Date(),
  };

  const spaceman = spacemanRepository.create(spacemanData);
  const savedSpaceman = await spacemanRepository.save(spaceman);
  
  console.log('✅ Spaceman record created successfully:', {
    id: savedSpaceman.id,
    gameId: savedSpaceman.gameId,
    bookmakerId: savedSpaceman.bookmakerId,
    urlSessionid: savedSpaceman.urlSessionid
  });

  return savedSpaceman;
}

// Para ejecutar directamente
if (require.main === module) {
  console.log('This script should be imported and run from another script');
}
