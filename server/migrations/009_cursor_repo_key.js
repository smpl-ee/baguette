export async function up(knex) {
  await knex.schema.alterTable('user_repos', (t) => {
    t.text('cursor_api_key_encrypted').nullable();
  });
  await knex.raw('ALTER TABLE users ADD COLUMN cursor_model TEXT');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE user_repos DROP COLUMN cursor_api_key_encrypted');
  await knex.raw('ALTER TABLE users DROP COLUMN cursor_model');
}
