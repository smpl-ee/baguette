export async function up(knex) {
  await knex.schema.createTable('plugins', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.text('marketplace_repo').notNullable();
    t.text('plugin_path').notNullable();
    t.text('local_path').notNullable();
    t.text('git_sha');
    t.text('description');
    t.datetime('created_at').notNullable();
    t.datetime('updated_at').notNullable();
    t.unique(['marketplace_repo', 'plugin_path']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('plugins');
}
