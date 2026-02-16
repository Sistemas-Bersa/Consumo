require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const { validateUserWithGraph } = require('./middleware/auth');

const app = express();

// 1. MIDDLEWARES
app.use(cors({ origin: ['https://bersacloud.app', 'https://consumos.bersacloud.app'], credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'disn')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'visual'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// 2. RUTAS

// CORRECCIÓN AQUÍ: La lógica debe estar DENTRO de la función (req, res)
app.get('/', (req, res) => {
    const token = req.query.token;
    if (token) {
        return res.redirect(`/consumo?token=${token}`);
    }
    res.redirect('/consumo');
});

app.get('/consumo', validateUserWithGraph, async (req, res) => {
    try {
        const userEmail = req.user.email.toLowerCase();
        const isCorp = (req.user.verifiedOffice || "").toLowerCase() === 'corporativo';
        const wh = req.query.wh;

        // Cargar almacenes
        const whQuery = isCorp 
            ? 'SELECT clave_sap, nombre FROM almacenes ORDER BY nombre ASC' 
            : `SELECT a.clave_sap, a.nombre 
               FROM almacenes a 
               JOIN usuario_almacenes ua ON a.clave_sap = ua.codigo_almacen 
               WHERE LOWER(ua.email) = $1 
               ORDER BY a.nombre ASC`;
        
        const whs = await pool.query(whQuery, isCorp ? [] : [userEmail]);
        const activeWh = wh || (whs.rows.length > 0 ? whs.rows[0].clave_sap : null);

     let datos = [];
if (activeWh) {
    const dataQuery = `
        SELECT * FROM vista_calculo_consumo 
        WHERE codigo_almacen = $1 
        AND (stock_teorico != 0 OR stock_fisico != 0) -- Solo mostramos lo que tenga algo de info
        ORDER BY producto ASC`;
    const resData = await pool.query(dataQuery, [activeWh]);
    datos = resData.rows;
}

        res.render('consumo', { 
            datos, 
            usuario: req.user, 
            almacenesPermitidos: whs.rows, 
            almacenActivo: activeWh 
        });

    } catch (e) { 
        console.error("❌ ERROR EN GET /CONSUMO:", e.stack);
        res.status(500).send("Error de servidor: " + e.message); 
    }
});

app.post('/procesar-ajuste', validateUserWithGraph, async (req, res) => {
    const client = await pool.connect();
    try {
        const { almacen } = req.body;
        await client.query('BEGIN');

        const diffs = await client.query(`
            SELECT codigo_general, diferencia 
            FROM vista_calculo_consumo 
            WHERE almacen = (SELECT nombre FROM almacenes WHERE clave_sap = $1) 
            AND diferencia != 0`, [almacen]);

        for (const row of diffs.rows) {
            await client.query(
                'INSERT INTO movimientos_inventario (origen_web, codigo_almacen, codigo_articulo, cantidad_enviada) VALUES ($1, $2, $3, $4)',
                ['CONSUMO_REAL', almacen, row.codigo_general, row.diferencia]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) { 
        await client.query('ROLLBACK'); 
        console.error("❌ ERROR EN POST /PROCESAR-AJUSTE:", e.stack);
        res.status(500).json({ error: e.message }); 
    }
    finally { client.release(); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Web Consumo activa en puerto ${PORT}`));