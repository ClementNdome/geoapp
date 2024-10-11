import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg'; // Assuming you're using pg to interact with PostgreSQL
import fs from 'fs';
import shp from 'shpjs'; // For reading shapefiles

const app = express();
const port = 5000;

// Configure PostgreSQL client (adjust to your PostgreSQL config)
import dotenv from 'dotenv';
dotenv.config();  // Load environment variables from .env file

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Set up Multer for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// Get the current directory for serving static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

// Upload shapefile route
app.post('/upload', upload.single('shapefile'), async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'uploads', req.file.filename);
    const shapefileData = await fs.promises.readFile(filePath);
    
    // Convert shapefile to GeoJSON using shpjs
    const geojson = await shp(shapefileData);

    // Loop through the GeoJSON features and insert them into the database
    const client = await pool.connect();
    for (const feature of geojson.features) {
      const { geometry, properties } = feature;
      const geom = JSON.stringify(geometry); // Convert geometry to a string for PostGIS
      const props = JSON.stringify(properties); // Convert properties to a JSON string
      await client.query(
        `INSERT INTO your_table_name (geom, properties) VALUES (ST_GeomFromGeoJSON($1), $2)`,
        [geom, props]
      );
    }

    client.release();
    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing shapefile:', error);
    res.sendStatus(500);
  }
});

// Fetch all points route
app.get('/points', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT ST_AsGeoJSON(geom), properties FROM your_table_name');
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature',
        geometry: JSON.parse(row.st_asgeojson),
        properties: row.properties,
      })),
    };
    client.release();
    res.json(geojson);
  } catch (error) {
    console.error('Error fetching points:', error);
    res.sendStatus(500);
  }
});

// Fetch nearby points route
app.get('/points/nearby', async (req, res) => {
  const { lat, lon, radius } = req.query;
  try {
    const client = await pool.connect();
    const result = await client.query(
      `SELECT ST_AsGeoJSON(geom), properties FROM your_table_name 
      WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)`,
      [lon, lat, radius]
    );
    const geojson = {
      type: 'FeatureCollection',
      features: result.rows.map((row) => ({
        type: 'Feature',
        geometry: JSON.parse(row.st_asgeojson),
        properties: row.properties,
      })),
    };
    client.release();
    res.json(geojson);
  } catch (error) {
    console.error('Error fetching nearby points:', error);
    res.sendStatus(500);
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
