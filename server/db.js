import Knex from 'knex';
import knexConfig from '../knexfile.js';

const db = Knex(knexConfig);

export default db;
