import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './routes/authRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import studyRoutes from './routes/studyRoutes.js';
import { initializeDatabase } from './db.js';

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to ClinResearch AI API',
    version: '1.0.0'
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/studies', studyRoutes);

const PORT = process.env.PORT || 5000;

initializeDatabase()
  .then(() => {
    console.log('Connected to PostgreSQL');
  })
  .catch((error) => {
    console.warn('⚠️ PostgreSQL connection failed (port 5432). Database routes will be unavailable until PostgreSQL is started.');
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  });
