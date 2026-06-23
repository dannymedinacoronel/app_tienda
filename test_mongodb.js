require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

mongoose.connect(uri)
    .then(() => {
        console.log("Conectado a MongoDB (TEST SCRIPT)");
        process.exit(0);
    })
    .catch((err) => {
        console.error("Fallo de conexión a MongoDB:", err);
        process.exit(1);
    });
