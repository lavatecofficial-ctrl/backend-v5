import { DataSource } from 'typeorm';
import { Game } from '../entities/game.entity';

export async function seedGames(dataSource: DataSource) {
  const gameRepository = dataSource.getRepository(Game);

  // Verificar si ya existen juegos
  const existingGames = await gameRepository.find();
  if (existingGames.length > 0) {
    console.log('Games already seeded, skipping...');
    return;
  }

  const games = [
    {
      name: 'Aviator',
      proveedor: 'Spribe',
      proveedor_img: '/logos/spribe.svg',
      game_img: '/games/aviator-logo.svg',
      color: '#ef4444',
      scale_img: 65,
      is_active: true,
    },
    {
      name: 'Spaceman',
      proveedor: 'Pragmatic Play',
      proveedor_img: '/logos/pragmatic-play.svg',
      game_img: '/games/spaceman-logo.svg',
      color: '#a855f7',
      scale_img: 65,
      is_active: true,
    },
    {
      name: 'Roulettes',
      proveedor: 'Pragmatic Play',
      proveedor_img: '/logos/pragmatic-play.svg',
      game_img: '/games/ruleta-logo.svg',
      color: '#eab308',
      scale_img: 65,
      is_active: true,
    },
  ];

  for (const gameData of games) {
    const game = gameRepository.create(gameData);
    await gameRepository.save(game);
    console.log(`Created game: ${game.name}`);
  }

  console.log('Games seeding completed!');
}
