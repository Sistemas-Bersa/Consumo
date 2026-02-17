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
        const office = (req.user.verifiedOffice || "").toLowerCase();
        const selectedWh = req.query.wh; 

        // 1. Obtener almacenes autorizados
        const whQuery = office === 'corporativo' 
            ? 'SELECT clave_sap, nombre FROM almacenes ORDER BY nombre ASC'
            : `SELECT a.clave_sap, a.nombre FROM almacenes a 
               JOIN usuario_almacenes ua ON a.clave_sap = ua.codigo_almacen 
               WHERE LOWER(ua.email) = $1 ORDER BY a.nombre ASC`;
        
        const whsResult = await pool.query(whQuery, office === 'corporativo' ? [] : [userEmail]);
        const activeWh = selectedWh || (whsResult.rows.length > 0 ? whsResult.rows[0].clave_sap : null);

   let datos = [];
        if (activeWh) {
            const dataQuery = `
                SELECT 
                    i.descripcion AS producto, 
                    i.codigo_articulo AS codigo_general, 
                    i.tipo AS unidad,
                    v.stock_actual -- Ya no necesitamos COALESCE porque filtraremos los nulos
                FROM vista_inventario_fisico_real v
                JOIN items i ON v.codigo_general = i.codigo_articulo
                WHERE v.codigo_almacen = $1 
                AND v.stock_actual > 0 -- EL FILTRO CLAVE
                ORDER BY i.descripcion ASC`;
            
            const resData = await pool.query(dataQuery, [activeWh]);
            datos = resData.rows;
        }

        res.render('consumo', { 
            datos, 
            usuario: req.user, 
            almacenesPermitidos: whsResult.rows, 
            almacenActivo: activeWh 
        });

    } catch (e) { 
        console.error("❌ ERROR EN GET /CONSUMO:", e.stack);
        res.status(500).send("Error de servidor"); 
    }
});

app.post('/procesar-ajuste', validateUserWithGraph, async (req, res) => {
    const client = await pool.connect();
    try {
        const { almacen, conteos } = req.body;
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
        console.error("❌ ERROR EN POST:", e.message);
        res.status(500).json({ error: e.message });
    } finally { client.release(); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Web Consumo activa en puerto ${PORT}`));