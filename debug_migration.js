require('dotenv').config();
const mongoose = require('mongoose');

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

mongoose.connect(uri)
    .then(async () => {
        try {
            const serverCode = require('fs').readFileSync('server.js', 'utf8');
            console.log("Connected to MongoDB for testing.");
            // We want to just find if Negocio model is exported properly, or if there's any reference error
            // Check if models exist
            console.log("Mongoose models:", Object.keys(mongoose.models));
            process.exit(0);
        } catch (e) {
            console.error(e);
            process.exit(1);
        }
    });
