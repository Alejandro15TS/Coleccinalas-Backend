const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'TU_CONTRASEÑA',
  database: 'coleccionalas_todas',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool.promise();