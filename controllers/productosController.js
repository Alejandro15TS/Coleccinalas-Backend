const db = require('../db');

async function getProductos(req, res) {
  try {
    const [rows] = await db.query('SELECT * FROM productos');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getProductos };