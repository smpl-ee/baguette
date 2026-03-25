export async function up(knex) {
  await knex.schema.alterTable('user_repos', (t) => {
    t.text('anthropic_api_key_encrypted').nullable();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('user_repos', (t) => {
    t.dropColumn('anthropic_api_key_encrypted');
  });
}
