export async function up(knex) {
  await knex.raw('ALTER TABLE sessions ADD COLUMN plugins TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE sessions DROP COLUMN plugins');
}
