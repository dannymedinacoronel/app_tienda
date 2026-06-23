require('dotenv').config();
const mongoose = require('mongoose');
const EstadoKanban = mongoose.model('EstadoKanban', new mongoose.Schema({
    negocio: { type: mongoose.Schema.Types.ObjectId },
    nombre: { type: String }
}));

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

mongoose.connect(uri)
    .then(async () => {
        const columns = await EstadoKanban.find({});
        console.log("Columnas existentes:", columns);
        process.exit(0);
    });
