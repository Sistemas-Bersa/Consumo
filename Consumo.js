require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { validateUserWithGraph } = require('./middleware/auth');

const app = express();

app.use(cors({ origin: ['https://bersacloud.app', 'https://consumos.bersacloud.app'], credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'disn')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'visual'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// RUTAS
app.get('/', (req, res) => {
    const token = req.query.token;
    if (token) return res.redirect(`/consumo?token=${token}`);
    res.redirect('/consumo');
});

app.get('/consumo', validateUserWithGraph, async (req, res) => {
    try {
        const userEmail = req.user.email.toLowerCase();
        const isCorp = (req.user.verifiedOffice || "").toLowerCase() === 'corporativo';
        const wh = req.query.wh;

        // 1. OBTENER ALMACENES (Aquí estaba el error antes)
        const whQuery = isCorp 
            ? 'SELECT clave_sap, nombre FROM almacenes ORDER BY nombre ASC'
            : `SELECT a.clave_sap, a.nombre FROM almacenes a 
               JOIN usuario_almacenes ua ON a.clave_sap = ua.codigo_almacen 
               WHERE LOWER(ua.email) = $1 ORDER BY a.nombre ASC`;
        
        const whsResult = await pool.query(whQuery, isCorp ? [] : [userEmail]);
        const activeWh = wh || null;

        // 2. OBTENER PRODUCTOS (Solo si hay almacén seleccionado)
        let datos = [];
        if (activeWh) {
            const itemsQuery = `
                SELECT 
                    i.descripcion AS producto, 
                    i.codigo_articulo AS codigo_general, 
                    i.tipo AS unidad,
                    COALESCE(v.stock_actual, 0) AS stock_actual
                FROM items i
                JOIN items_almacen ia ON i.codigo_articulo = ia.codigo_articulo
                LEFT JOIN vista_inventario_fisico_real v ON v.codigo_general = i.codigo_articulo 
                    AND v.codigo_almacen = $1
                WHERE ia.codigo_almacen = $1
                ORDER BY i.descripcion ASC`;
            
            const resData = await pool.query(itemsQuery, [activeWh]);
            datos = resData.rows;
        }

        res.render('consumo', { 
            datos, 
            usuario: req.user, 
            almacenesPermitidos: whsResult.rows, 
            almacenActivo: activeWh 
        });

    } catch (e) { 
        console.error("❌ ERROR EN GET /CONSUMO:", e.stack); // Muestra el error real en logs
        res.status(500).send("Error de servidor: " + e.message); 
    }
});

app.post('/procesar-ajuste', validateUserWithGraph, async (req, res) => {
    const { almacen, conteos } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const item of conteos) {
            await client.query(
                'INSERT INTO inventario_fisico (email_operador, codigo_almacen, codigo_articulo, cantidad_fisica) VALUES ($1, $2, $3, $4)',
                [req.user.email, almacen, item.codigo, item.cantidad]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Web Consumo activa en puerto ${PORT}`));