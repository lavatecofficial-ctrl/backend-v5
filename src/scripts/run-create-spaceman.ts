import { DataSource } from 'typeorm';
import { createSpacemanRecord } from './create-spaceman-record';
import { seedSpacemanBookmakers } from './seed-spaceman-bookmakers';

// Configuración de la base de datos
const dataSource = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  username: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'aviarix2',
  entities: [__dirname + '/../entities/*.entity{.ts,.js}'],
  synchronize: false,
  logging: true,
});

async function main() {
  try {
    console.log('🚀 Iniciando creación de registro Spaceman...');
    
    // Conectar a la base de datos
    await dataSource.initialize();
    console.log('✅ Base de datos conectada');

    // Crear bookmakers si no existen
    console.log('📋 Creando bookmakers de Spaceman...');
    await seedSpacemanBookmakers(dataSource);
    
    // Crear registro de Spaceman
    console.log('🔧 Creando registro de Spaceman...');
    const spaceman = await createSpacemanRecord(dataSource);
    
    console.log('🎉 Proceso completado exitosamente!');
    console.log('📊 Resumen:');
    console.log(`   - Bookmakers creados/verificados`);
    console.log(`   - Spaceman record ID: ${spaceman.id}`);
    console.log(`   - Bookmaker ID: ${spaceman.bookmakerId}`);
    console.log(`   - Game ID: ${spaceman.gameId}`);

  } catch (error) {
    console.error('❌ Error durante la ejecución:', error);
    process.exit(1);
  } finally {
    // Cerrar conexión
    if (dataSource.isInitialized) {
      await dataSource.destroy();
      console.log('🔌 Conexión a base de datos cerrada');
    }
  }
}

// Ejecutar el script
main().catch(console.error);
