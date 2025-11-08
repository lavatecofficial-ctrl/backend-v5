import { DataSource } from 'typeorm';
import { Bookmaker } from '../entities/bookmaker.entity';

export async function seedBookmakers(dataSource: DataSource) {
  const bookmakerRepository = dataSource.getRepository(Bookmaker);

  // Verificar si ya existen bookmakers
  const existingBookmakers = await bookmakerRepository.count();
  if (existingBookmakers > 0) {
    console.log('Bookmakers ya existen, saltando seeding...');
    return;
  }

  // Datos iniciales para Aviator (game_id: 1) y Roulettes (game_id: 3)
  const bookmakersData = [
    {
      gameId: 1,
      bookmaker: '888Starz',
      bookmakerImg: '/logos/888starz-logo.svg',
      scaleImg: 65,
      isActive: true,
    },
    {
      gameId: 1,
      bookmaker: 'GoBet',
      bookmakerImg: '/logos/gobet-logo.svg',
      scaleImg: 65,
      isActive: true,
    },
    {
      gameId: 1,
      bookmaker: '1xbet',
      bookmakerImg: '/logos/1xbet-logo.svg',
      scaleImg: 65,
      isActive: true,
    },
    {
      gameId: 1,
      bookmaker: '1Win',
      bookmakerImg: '/logos/1win-logo.svg',
      scaleImg: 65,
      isActive: false, // Este estará offline para demostrar la funcionalidad
    },
    // Roulettes (game_id: 3)
    {
      gameId: 3,
      bookmaker: 'Macao Roulette',
      bookmakerImg: '/logos/macao-roulette.svg',
      scaleImg: 65,
      isActive: true,
    },
    {
      gameId: 3,
      bookmaker: 'Mega Roulette',
      bookmakerImg: '/logos/mega-roulette.svg',
      scaleImg: 65,
      isActive: true,
    },
    {
      gameId: 3,
      bookmaker: 'Lightning Roulette',
      bookmakerImg: '/logos/lightning-roulette.svg',
      scaleImg: 65,
      isActive: true,
    },
  ];

  try {
    for (const bookmakerData of bookmakersData) {
      const bookmaker = bookmakerRepository.create(bookmakerData);
      await bookmakerRepository.save(bookmaker);
    }
    console.log('✅ Bookmakers sembrados exitosamente');
  } catch (error) {
    console.error('❌ Error sembrando bookmakers:', error);
  }
}
