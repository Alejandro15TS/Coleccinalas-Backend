const express = require('express');
const router = express.Router();
const { getProductos } = require('../controllers/productosController');

router.get('/', getProductos);

module.exports = router;