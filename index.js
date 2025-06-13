const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
require('dotenv').config();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// Middleware para verificar JWT
const verificarToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token no proporcionado' });

  jwt.verify(token, 'secreto', (err, usuario) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.usuario = usuario;
    next();
  });
};

// Middleware para verificar si el usuario es admin
const verificarAdmin = (req, res, next) => {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado: se requiere rol de administrador' });
  }
  next();
};

// Conexión a la base de datos
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: process.env.DB_PASSWORD,
  database: 'coleccionalas_todas'
});

db.connect((err) => {
  if (err) {
    console.error('Error al conectar a MySQL:', err);
  } else {
    console.log('Conectado a la base de datos MySQL');
  }
});

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('¡Backend funcionando!');
});

// Ruta para obtener todos los productos
app.get('/productos', (req, res) => {
  const sql = `
    SELECT productos.*, categorias.nombre AS categoria_nombre
    FROM productos
    JOIN categorias ON productos.categoria_id = categorias.id
  `;
  db.query(sql, (err, resultados) => {
    if (err) {
      console.error('Error al obtener productos:', err);
      res.status(500).json({ error: 'Error del servidor' });
    } else {
      res.json(resultados);
    }
  });
});

// Ruta para registrar usuarios
app.post('/registro', async (req, res) => {
  const { nombre, email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.query(
      'INSERT INTO usuarios (nombre, email, password) VALUES (?, ?, ?)',
      [nombre, email, hashedPassword],
      (err, result) => {
        if (err) {
          console.error('Error al registrar:', err);
          return res.status(500).json({ error: 'Error al registrar' });
        }
        res.status(200).json({ mensaje: 'Usuario registrado correctamente' });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Ruta para login de usuarios
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.query('SELECT * FROM usuarios WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Error al buscar usuario' });
    if (results.length === 0) return res.status(401).json({ error: 'Usuario no encontrado' });

    const usuario = results[0];
    const esValido = await bcrypt.compare(password, usuario.password);

    if (!esValido) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const token = jwt.sign(
      { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol },
      'secreto',
      { expiresIn: '1h' }
    );

    res.json({
      mensaje: 'Login exitoso',
      token,
      usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol }
    });
  });
});

// RUTA CORREGIDA para crear un pedido
app.post('/crear-pedido', verificarToken, (req, res) => {
  const usuarioId = req.usuario.id;
  const { carrito, metodo_pago } = req.body;

  if (!usuarioId || !carrito || carrito.length === 0) {
    return res.status(400).json({ error: 'Datos incompletos para crear el pedido' });
  }

  const total = carrito.reduce((acc, item) => acc + item.precio * item.cantidad, 0);

  const pedidoSql = 'INSERT INTO pedidos (usuario_id, metodo_pago, total) VALUES (?, ?, ?)';
  db.query(pedidoSql, [usuarioId, metodo_pago, total], (err, resultadoPedido) => {
    if (err) {
      console.error('Error al insertar pedido:', err);
      return res.status(500).json({ error: 'Error al crear el pedido' });
    }

    const pedido_id = resultadoPedido.insertId;

    const detallesSql = 'INSERT INTO detalles_pedido (pedido_id, producto_id, cantidad, precio_unitario) VALUES ?';
    const valores = carrito.map(item => [pedido_id, item.id, item.cantidad, item.precio]);

    db.query(detallesSql, [valores], (err) => {
      if (err) {
        console.error('Error al insertar detalles:', err);
        return res.status(500).json({ error: 'Error al guardar detalles del pedido' });
      }

      res.status(200).json({ mensaje: 'Pedido creado con éxito', pedido_id });
    });
  });
});

// Obtener historial de pedidos del usuario autenticado
app.get('/historial-pedidos', verificarToken, (req, res) => {
  const usuarioId = req.usuario.id;

  const sqlPedidos = 'SELECT * FROM pedidos WHERE usuario_id = ? ORDER BY fecha DESC';

  db.query(sqlPedidos, [usuarioId], (err, pedidos) => {
    if (err) {
      console.error('Error al obtener pedidos:', err);
      return res.status(500).json({ error: 'Error al obtener pedidos' });
    }

    const ids = pedidos.map(p => p.id);
    if (ids.length === 0) return res.json([]);

    const sqlDetalles = `
      SELECT * FROM detalles_pedido 
      WHERE pedido_id IN (?)
    `;

    db.query(sqlDetalles, [ids], (err, detalles) => {
      if (err) {
        console.error('Error al obtener detalles:', err);
        return res.status(500).json({ error: 'Error al obtener detalles' });
      }

      const detallesPorPedido = {};
      detalles.forEach(d => {
        if (!detallesPorPedido[d.pedido_id]) detallesPorPedido[d.pedido_id] = [];
        detallesPorPedido[d.pedido_id].push(d);
      });

      const resultado = pedidos.map(p => ({
        ...p,
        detalles: detallesPorPedido[p.id] || []
      }));

      res.json(resultado);
    });
  });
});

// Crear producto (protegido)
app.post('/productos', verificarToken, verificarAdmin, (req, res) => {
  const { nombre, descripcion, precio, imagen_url, categoria_id } = req.body;
  const sql = 'INSERT INTO productos (nombre, descripcion, precio, imagen_url, categoria_id) VALUES (?, ?, ?, ?, ?)';
  db.query(sql, [nombre, descripcion, precio, imagen_url, categoria_id], (err) => {
    if (err) return res.status(500).json({ error: 'Error al crear producto' });
    res.status(200).json({ mensaje: 'Producto creado' });
  });
});

// Eliminar producto (protegido)
app.delete('/productos/:id', verificarToken, verificarAdmin, (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM productos WHERE id = ?', [id], (err) => {
    if (err) return res.status(500).json({ error: 'Error al eliminar producto' });
    res.status(200).json({ mensaje: 'Producto eliminado' });
  });
});

// Editar productos (protegido)
app.put('/admin/productos/:id', verificarToken, verificarAdmin, (req, res) => {
  const { id } = req.params;
  const { nombre, descripcion, precio, imagen_url, categoria_id } = req.body;

  const sql = `
    UPDATE productos
    SET nombre = ?, descripcion = ?, precio = ?, imagen_url = ?, categoria_id = ?
    WHERE id = ?
  `;

  db.query(sql, [nombre, descripcion, precio, imagen_url, categoria_id, id], (err, resultado) => {
    if (err) {
      console.error('Error al actualizar producto:', err);
      return res.status(500).json({ error: 'Error al actualizar producto' });
    }

    res.status(200).json({ mensaje: 'Producto actualizado correctamente' });
  });
});

app.listen(3001, () => {
  console.log('Servidor backend corriendo en http://localhost:3001');
});
