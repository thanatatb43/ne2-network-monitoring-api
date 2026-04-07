require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || null,
    database: process.env.DB_NAME || 'ne2_netw0rk_moitoring_api',
    host: process.env.DB_IP_ADDRESS_TEST || '127.0.0.1',
    dialect: process.env.DB_DIALECT || 'mysql',
    timezone: '+07:00',
    storage: process.env.DB_STORAGE || './database.sqlite'
  },
  test: {
    username: 'root',
    password: null,
    database: 'database_test',
    host: '127.0.0.1',
    dialect: 'mysql'
  },
  production: {
    username: 'root',
    password: null,
    database: 'database_production',
    host: '127.0.0.1',
    dialect: 'mysql'
  }
};