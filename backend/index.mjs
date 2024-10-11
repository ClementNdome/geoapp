import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import shp from 'shpjs';
import pg from 'pg';

dotenv.config(); // Load environment variables from .env file

const app = express();
const port = process.env.PORT || 5000;

// PostgreSQL connection pool
const { Pool } = pg;
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Middleware to handle file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });

// Endpoint to upload a shapefile
app.post('/upload', upload.single('shapefile'), async (req, res) => {
  const filePath = path.join(__dirname, 'uploads', req.file.filename);

  try {
    // Read the uploaded shapefile
    const data = await shp.readFile(filePath);

    // Log the extracted features
    console.log("Extracted GeoJSON features:", data.features);

    // Extract features and insert them into the PostgreSQL database
    const client = await pool.connect();
    await Promise.all(
      data.features.map(async (feature) => {
        const { geometry, properties } = feature;
        const geom = JSON.stringify(geometry); // Store the geometry as JSON

        await client.query(
          'INSERT INTO your_table_name(geom, properties) VALUES (ST_GeomFromGeoJSON($1), $2)',
          [geom, JSON.stringify(properties)]
        );
      })
    );

    client.release();
    res.status(200).json({ message: 'Shapefile uploaded and data inserted successfully!' });
  } catch (error) {
    console.error('Error uploading shapefile:', error);
    res.status(500).json({ error: 'Error uploading shapefile' });
  }
});

// Endpoint to retrieve points from the database
app.get('/points', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM your_table_name');
    console.log("Retrieved points from the database:", result.rows); // Log retrieved points

    // Filter out any null features
    const geojson = {
      type: "FeatureCollection",
      features: result.rows
        .filter(row => row.geom !== null) // Ensure geom is not null
        .map(row => ({
          type: "Feature",
          geometry: JSON.parse(row.geom), // Parse the geometry
          properties: row.properties,
        })),
    };

    res.status(200).json(geojson);
  } catch (error) {
    console.error('Error retrieving points:', error);
    res.status(500).json({ error: 'Error retrieving points' });
  }
});

// Endpoint for proximity search
app.get('/points/nearby', async (req, res) => {
  const { lat, lon, radius } = req.query;
  try {
    const result = await pool.query(
      `SELECT ST_AsGeoJSON(geom) AS geom, properties 
      FROM your_table_name 
      WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
      [lon, lat, radius]
    );

    const geojson = {
      type: "FeatureCollection",
      features: result.rows.map(row => ({
        type: "Feature",
        geometry: JSON.parse(row.geom), // Parse the geometry
        properties: row.properties,
      })),
    };

    res.status(200).json(geojson);
  } catch (error) {
    console.error('Error fetching nearby points:', error);
    res.status(500).json({ error: 'Error fetching nearby points' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
