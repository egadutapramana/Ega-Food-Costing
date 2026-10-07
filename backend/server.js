require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const { requireAuth } = require('./middleware/auth');
const { startBackupScheduler } = require('./utils/backup');

const authRoutes = require('./routes/auth');
const ingredientRoutes = require('./routes/ingredients');
const recipeRoutes = require('./routes/recipes');
const supplierRoutes = require('./routes/suppliers');
const reportRoutes = require('./routes/reports');
const backupRoutes = require('./routes/backup');
const categoryRoutes = require('./routes/categories');
const inventoryRoutes = require('./routes/inventory');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

app.use('/api/auth', authRoutes);
app.use('/api/ingredients', requireAuth, ingredientRoutes);
app.use('/api/recipes', requireAuth, recipeRoutes);
app.use('/api/suppliers', requireAuth, supplierRoutes);
app.use('/api/reports', requireAuth, reportRoutes);
app.use('/api/backup', requireAuth, backupRoutes);
app.use('/api/categories', requireAuth, categoryRoutes);
app.use('/api/inventory', requireAuth, inventoryRoutes);

app.get('/', (req, res) => {
    res.send('Food Cost API is running');
});

// Dijalankan langsung (lokal / Railway): buka port sendiri + backup otomatis.
// Di Vercel, file ini di-require oleh api/index.js sebagai serverless function, jadi tidak listen.
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}`);
        startBackupScheduler();
    });
}

module.exports = app;

