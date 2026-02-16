const axios = require('axios');

const validateUserWithGraph = async (req, res, next) => {
    try {
        // 1. Buscamos el token en: URL -> Headers -> Cookies
        let token = req.query.token || 
                    req.headers.authorization?.split(' ')[1] || 
                    req.cookies?.azure_token;

        if (!token) {
            console.log("⚠️ Sin token, redirigiendo al portal...");
            return res.send(`<script>window.location.href = "https://bersacloud.app";</script>`);
        }

        // 2. Si hay token en la URL, lo guardamos y limpiamos la URL
        if (req.query.token) {
            console.log("🎟️ Nuevo token detectado, actualizando sesión...");
            
            // Configuramos la cookie de forma segura pero flexible
            const cookieOptions = {
                maxAge: 3600000, 
                httpOnly: true, 
                secure: true, 
                sameSite: 'Lax'
            };

            // SOLO agregamos el dominio si el usuario ya está usando el dominio oficial
            if (req.hostname.endsWith('bersacloud.app')) {
                cookieOptions.domain = '.bersacloud.app';
            }

            res.cookie('azure_token', token, cookieOptions);
            
            // Redirigimos a la ruta actual limpia (ej: /consumo)
            return res.redirect(req.baseUrl + req.path);
        }

        // 3. Validamos contra Microsoft Graph
        // Usamos $select para asegurar que traiga el email o UPN
        const response = await axios.get('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,officeLocation', {
            headers: { Authorization: `Bearer ${token}` }
        });

        const userData = response.data;
        
        // Asignamos el usuario a req.user para que el backend lo use
        req.user = {
            name: userData.displayName,
            // Fallback: si no hay mail, usamos userPrincipalName
            email: (userData.mail || userData.userPrincipalName || "").toLowerCase(),
            verifiedOffice: userData.officeLocation || "Oficina General"
        };

        console.log(`🔒 Sesión activa: ${req.user.email}`);
        next();

    } catch (error) {
        console.error("⛔ Error de Autenticación:", error.message);
        
        // Limpiamos la cookie si el token ya no es válido
        const clearOptions = req.hostname.endsWith('bersacloud.app') ? { domain: '.bersacloud.app' } : {};
        res.clearCookie('azure_token', clearOptions);
        
        return res.status(401).send("Sesión expirada. Por favor, reingrese desde el portal.");
    }
};

module.exports = { validateUserWithGraph };