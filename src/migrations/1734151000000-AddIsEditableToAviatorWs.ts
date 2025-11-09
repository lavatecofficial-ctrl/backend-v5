import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIsEditableToAviatorWs1734151000000 implements MigrationInterface {
  name = 'AddIsEditableToAviatorWs1734151000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Add column nullable first
    await queryRunner.query(`ALTER TABLE "aviator_ws" ADD COLUMN "is_editable" boolean`);

    // 2) Backfill: set true for all
    await queryRunner.query(`UPDATE "aviator_ws" SET "is_editable" = true`);

    // 3) Set gobet (game_id = 1) to false
    await queryRunner.query(`
      UPDATE "aviator_ws" aw
      SET "is_editable" = false
      FROM "bookmakers" b
      WHERE aw.bookmaker_id = b.id
        AND LOWER(b.bookmaker) = 'gobet'
        AND b.game_id = 1
    `);

    // 4) Enforce NOT NULL + default true
    await queryRunner.query(`ALTER TABLE "aviator_ws" ALTER COLUMN "is_editable" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "aviator_ws" ALTER COLUMN "is_editable" SET DEFAULT true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "aviator_ws" DROP COLUMN "is_editable"`);
  }
}
