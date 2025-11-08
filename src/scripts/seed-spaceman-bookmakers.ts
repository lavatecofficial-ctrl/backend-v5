import { DataSource } from 'typeorm';
import { Bookmaker } from '../entities/bookmaker.entity';

export async function seedSpacemanBookmakers(dataSource: DataSource) {
  const bookmakerRepository = dataSource.getRepository(Bookmaker);

  // ID de Spaceman en la tabla games (basado en seed-games.ts)
  const SPACEMAN_GAME_ID = 2;

  // Verificar si ya existen bookmakers para Spaceman
  const existingSpacemanBookmakers = await bookmakerRepository.find({
    where: { gameId: SPACEMAN_GAME_ID }
  });

  if (existingSpacemanBookmakers.length > 0) {
    console.log('Spaceman bookmakers already seeded, skipping...');
    return;
  }

  const spacemanBookmakers = [
    {
      gameId: SPACEMAN_GAME_ID,
      bookmaker: '888Starz',
      bookmakerImg: '/logos/888starz-logo.svg',
      scaleImg: 65,
      isActive: true, // El único activo como especificaste
    },
    {
      gameId: SPACEMAN_GAME_ID,
      bookmaker: '1xbet',
      bookmakerImg: '/logos/1xbet-logo.svg',
      scaleImg: 60,
      isActive: false,
    },
    {
      gameId: SPACEMAN_GAME_ID,
      bookmaker: '1Win',
      bookmakerImg: '/logos/1win-logo.svg',
      scaleImg: 50,
      isActive: false,
    },
  ];

  for (const bookmakerData of spacemanBookmakers) {
    const bookmaker = bookmakerRepository.create(bookmakerData);
    await bookmakerRepository.save(bookmaker);
    console.log(`Created Spaceman bookmaker: ${bookmaker.bookmaker} (Active: ${bookmaker.isActive})`);
  }

  console.log('Spaceman bookmakers seeding completed!');
  console.log('Active bookmaker: 888Starz');
}

// Este archivo solo exporta la función para ser usada en otros lugares
// Para ejecutar directamente, usar el script run-spaceman-seed.ts que ya funcionó
