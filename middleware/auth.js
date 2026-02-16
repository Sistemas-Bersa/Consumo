const axios = require('axios');

const validateUserWithGraph = async (req, res, next) => {
    try {
        let token = req.query.token || req.cookies?.azure_token;

        if (!token) {
            console.log("⚠️ Sin token, redirigiendo al portal...");
            return res.send(`<script>window.location.href = "https://bersacloud.app";</script>`);
        }

        if (req.query.token) {
            console.log("🎟️ Token detectado en URL, guardando cookie...");
            res.cookie('azure_token', token, { 
                maxAge: 3600000, 
                httpOnly: true, 
                secure: true, 
                sameSite: 'Lax',
                domain: '.bersacloud.app'
            });
            return res.redirect(req.baseUrl + req.path);
        }

        const response = await axios.get('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,officeLocation', {
            headers: { Authorization: `Bearer ${token}` }
        });

        const userData = response.data;
        req.user = {
            name: userData.displayName,
            email: (userData.mail || userData.userPrincipalName).toLowerCase(),
            verifiedOffice: userData.officeLocation || "Oficina General"
        };

        next();

    } catch (error) {
        console.error("⛔ Error de Token:", error.message);
        res.clearCookie('azure_token', { domain: '.bersacloud.app' });
        return res.status(401).send("Sesión expirada. Por favor, reingrese desde el portal.");
    }
};

module.exports = { validateUserWithGraph };