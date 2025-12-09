const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');
const app = express();
const { daysInclusive } = require('./lib/utils');

// Metrics tracking for DevOps monitoring
const metrics = {
  totalRentals: 0,
  activeRentals: 0,
  totalRevenue: 0,
  requestCount: 0,
  startTime: Date.now()
};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Request tracking middleware
app.use((req, res, next) => {
  metrics.requestCount++;
  next();
});

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'car_rental_db'
};

let db;

// In-memory fallback when DB is not available (allows `docker run` without MySQL)
let useInMemory = false;
let inMemoryCars = [];
let inMemoryRentals = [];

// metrics declared above
async function initDB() {
  try {
    db = await mysql.createConnection(dbConfig);

    // Create cars table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS cars (
        id INT AUTO_INCREMENT PRIMARY KEY,
        make VARCHAR(100) NOT NULL,
        model VARCHAR(100) NOT NULL,
        year INT,
        daily_rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        available TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);

    // Create rentals table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS rentals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        car_id INT NOT NULL,
        renter_name VARCHAR(255) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        total_cost DECIMAL(10,2) DEFAULT 0.00,
        status ENUM('ongoing','returned','cancelled') NOT NULL DEFAULT 'ongoing',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_rental_car FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB
    `);

    // Seed some sample cars if table is empty
    const [rows] = await db.execute('SELECT COUNT(*) as cnt FROM cars');
    const count = rows[0].cnt || 0;
    if (count === 0) {
      const sampleCars = [
        ['Toyota', 'Corolla', 2020, 35.00, 1],
        ['Honda', 'Civic', 2019, 37.50, 1],
        ['Ford', 'Focus', 2018, 30.00, 1]
      ];
      const placeholders = sampleCars.map(() => '(?,?,?,?,?)').join(',');
      const values = sampleCars.flat();
      await db.execute(
        `INSERT INTO cars (make, model, year, daily_rate, available) VALUES ${placeholders}`,
        values
      );
      console.log('Seeded sample cars');
    }

    console.log('Database connected and tables ensured');
  } catch (error) {
    console.error('Database connection failed, falling back to in-memory store:', error.message || error);
    useInMemory = true;

    // Seed some sample cars in-memory
    inMemoryCars = [
      { id: 1, make: 'Toyota', model: 'Corolla', year: 2020, daily_rate: '35.00', available: 1, created_at: new Date().toISOString() },
      { id: 2, make: 'Honda', model: 'Civic', year: 2019, daily_rate: '37.50', available: 1, created_at: new Date().toISOString() },
      { id: 3, make: 'Ford', model: 'Focus', year: 2018, daily_rate: '30.00', available: 1, created_at: new Date().toISOString() }
    ];

    console.warn('Running with in-memory data. Data will not persist across restarts.');
  }
}

// Update metrics from database
async function updateMetrics() {
  try {
    if (useInMemory) {
      metrics.totalRentals = inMemoryRentals.length;
      metrics.activeRentals = inMemoryRentals.filter(r => r.status === 'ongoing').length;
      metrics.totalRevenue = inMemoryRentals.reduce((sum, r) => sum + parseFloat(r.total_cost || 0), 0);
      return;
    }

    const [rentals] = await db.execute('SELECT COUNT(*) as cnt FROM rentals');
    const [activeRentals] = await db.execute("SELECT COUNT(*) as cnt FROM rentals WHERE status = 'ongoing'");
    const [revenue] = await db.execute('SELECT SUM(total_cost) as total FROM rentals WHERE status IN ("ongoing", "returned")');

    metrics.totalRentals = rentals[0].cnt || 0;
    metrics.activeRentals = activeRentals[0].cnt || 0;
    metrics.totalRevenue = parseFloat(revenue[0].total) || 0;
  } catch (error) {
    console.error('Error updating metrics:', error);
  }
}

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET all cars
app.get('/api/cars', async (req, res) => {
  try {
    if (useInMemory) return res.json(inMemoryCars);
    const [rows] = await db.execute('SELECT * FROM cars ORDER BY id');
    res.json(rows);
  } catch (error) {
    console.error('Error fetching cars:', error);
    res.status(500).json({ error: 'Failed to fetch cars' });
  }
});

// GET all rentals (with car info)
app.get('/api/rentals', async (req, res) => {
  try {
    if (useInMemory) {
      // join rental with car info
      const rows = inMemoryRentals
        .slice()
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .map(r => {
          const car = inMemoryCars.find(c => c.id === r.car_id) || {};
          return { ...r, make: car.make, model: car.model, year: car.year, daily_rate: car.daily_rate };
        });
      return res.json(rows);
    }
    const [rows] = await db.execute(`
      SELECT r.*, c.make, c.model, c.year, c.daily_rate
      FROM rentals r
      JOIN cars c ON r.car_id = c.id
      ORDER BY r.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching rentals:', error);
    res.status(500).json({ error: 'Failed to fetch rentals' });
  }
});

// use `daysInclusive` from `lib/utils`

// POST create a rental
app.post('/api/rentals', async (req, res) => {
  const { car_id, renter_name, start_date, end_date } = req.body;

  if (!car_id || !renter_name || !start_date || !end_date) {
    return res.status(400).json({ error: 'car_id, renter_name, start_date and end_date are required' });
  }

  try {
    if (useInMemory) {
      const car = inMemoryCars.find(c => c.id === Number(car_id));
      if (!car) return res.status(404).json({ error: 'Car not found' });
      if (car.available === 0) return res.status(400).json({ error: 'Car is not available for rental' });

      const days = daysInclusive(start_date, end_date);
      if (days === 0) return res.status(400).json({ error: 'Invalid dates' });
      const total_cost = (parseFloat(car.daily_rate) * days).toFixed(2);

      const newId = inMemoryRentals.length ? Math.max(...inMemoryRentals.map(r => r.id)) + 1 : 1;
      const rental = { id: newId, car_id: Number(car_id), renter_name, start_date, end_date, total_cost, status: 'ongoing', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      inMemoryRentals.push(rental);
      car.available = 0;
      return res.status(201).json({ ...rental, message: 'Rental created (in-memory)' });
    }

    // Fetch car and ensure available
    const [cars] = await db.execute('SELECT * FROM cars WHERE id = ? FOR UPDATE', [car_id]);
    if (!cars || cars.length === 0) {
      return res.status(404).json({ error: 'Car not found' });
    }
    const car = cars[0];
    if (car.available === 0) {
      return res.status(400).json({ error: 'Car is not available for rental' });
    }

    // Calculate days and total cost
    const start = new Date(start_date);
    const end = new Date(end_date);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) {
      return res.status(400).json({ error: 'Invalid dates' });
    }
    const msPerDay = 1000 * 60 * 60 * 24;
    const days = Math.ceil((end - start) / msPerDay) + 1;
    const total_cost = (parseFloat(car.daily_rate) * days).toFixed(2);

    // Insert rental and mark car unavailable
    const [result] = await db.execute(
      'INSERT INTO rentals (car_id, renter_name, start_date, end_date, total_cost) VALUES (?, ?, ?, ?, ?)',
      [car_id, renter_name, start_date, end_date, total_cost]
    );

    await db.execute('UPDATE cars SET available = 0 WHERE id = ?', [car_id]);

    res.status(201).json({ id: result.insertId, car_id, renter_name, start_date, end_date, total_cost, message: 'Rental created' });
  } catch (error) {
    console.error('Error creating rental:', error);
    res.status(500).json({ error: 'Failed to create rental' });
  }
});

// PUT update rental (e.g., mark returned or update dates)
app.put('/api/rentals/:id', async (req, res) => {
  const { id } = req.params;
  const { status, end_date } = req.body;

  try {
    if (useInMemory) {
      const rental = inMemoryRentals.find(r => r.id === Number(id));
      if (!rental) return res.status(404).json({ error: 'Rental not found' });

      let total_cost = rental.total_cost;
      if (end_date) {
        const car = inMemoryCars.find(c => c.id === rental.car_id);
        const days = daysInclusive(rental.start_date, end_date);
        if (days === 0) return res.status(400).json({ error: 'Invalid end_date' });
        total_cost = (parseFloat(car.daily_rate) * days).toFixed(2);
        rental.end_date = end_date;
        rental.total_cost = total_cost;
      }
      if (status) {
        rental.status = status;
        if (status === 'returned') {
          const car = inMemoryCars.find(c => c.id === rental.car_id);
          if (car) car.available = 1;
        }
      }
      rental.updated_at = new Date().toISOString();
      return res.json({ message: 'Rental updated (in-memory)', id: rental.id, status: rental.status, end_date: rental.end_date, total_cost: rental.total_cost });
    }

    const [rows] = await db.execute('SELECT * FROM rentals WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Rental not found' });
    }
    const rental = rows[0];

    let total_cost = rental.total_cost;

    // If end_date changed, recompute total
    if (end_date) {
      const [carRows] = await db.execute('SELECT daily_rate FROM cars WHERE id = ?', [rental.car_id]);
      const car = carRows[0];
      const start = new Date(rental.start_date);
      const end = new Date(end_date);
      if (isNaN(end.getTime()) || end < start) {
        return res.status(400).json({ error: 'Invalid end_date' });
      }
      const msPerDay = 1000 * 60 * 60 * 24;
      const days = Math.ceil((end - start) / msPerDay) + 1;
      total_cost = (parseFloat(car.daily_rate) * days).toFixed(2);
    }

    // Update rental
    await db.execute('UPDATE rentals SET end_date = ?, total_cost = ?, status = ? WHERE id = ?', [end_date || rental.end_date, total_cost, status || rental.status, id]);

    // If rental marked returned, mark car available
    if (status === 'returned') {
      await db.execute('UPDATE cars SET available = 1 WHERE id = ?', [rental.car_id]);
    }

    res.json({ message: 'Rental updated', id, status: status || rental.status, end_date: end_date || rental.end_date, total_cost });
  } catch (error) {
    console.error('Error updating rental:', error);
    res.status(500).json({ error: 'Failed to update rental' });
  }
});

// DELETE rental (optional): will not free the car automatically
app.delete('/api/rentals/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (useInMemory) {
      const idx = inMemoryRentals.findIndex(r => r.id === Number(id));
      if (idx === -1) return res.status(404).json({ error: 'Rental not found' });
      inMemoryRentals.splice(idx, 1);
      return res.json({ message: 'Rental deleted (in-memory)' });
    }

    const [result] = await db.execute('DELETE FROM rentals WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Rental not found' });
    }
    res.json({ message: 'Rental deleted' });
  } catch (error) {
    console.error('Error deleting rental:', error);
    res.status(500).json({ error: 'Failed to delete rental' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// DevOps Metrics endpoint for monitoring
app.get('/metrics', async (req, res) => {
  await updateMetrics();
  const uptime = Math.floor((Date.now() - metrics.startTime) / 1000);
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime_seconds: uptime,
    rentals: {
      total: metrics.totalRentals,
      active: metrics.activeRentals,
      completed: metrics.totalRentals - metrics.activeRentals
    },
    revenue: {
      total: parseFloat(metrics.totalRevenue).toFixed(2),
      currency: 'USD'
    },
    requests: {
      total: metrics.requestCount
    }
  });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  await initDB();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();
