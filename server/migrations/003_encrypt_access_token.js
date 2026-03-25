export async function up(knex) {
  await knex.schema.table('users', (t) => {
    t.text('access_token_encrypted').nullable();
  });
  await knex.schema.table('users', (t) => {
    t.dropColumn('access_token');
  });
}

export async function down(knex) {
  await knex.schema.table('users', (t) => {
    t.text('access_token').notNullable().defaultTo('');
  });
  await knex.schema.table('users', (t) => {
    t.dropColumn('access_token_encrypted');
  });
}
