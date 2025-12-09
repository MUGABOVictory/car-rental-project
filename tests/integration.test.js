/**
 * Integration Tests
 * Tests the app with MySQL running (via Docker Compose)
 * 
 * To run these tests:
 *   docker-compose up -d  # Bring up MySQL and app
 *   npm run test:integration
 *   docker-compose down   # Tear down
 */

const request = require('supertest');
const mysql = require('mysql2/promise');

const APP_URL = process.env.APP_URL || 'http://localhost:8001';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || 'password';
const DB_NAME = process.env.DB_NAME || 'car_rental_db';

let db;

// Helper to connect to MySQL
async function connectDB() {
  try {
    db = await mysql.createConnection({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME
    });
    return db;
  } catch (error) {
    console.error('Failed to connect to MySQL:', error.message);
    throw error;
  }
}

// Helper to clean up database before each test
async function cleanDatabase() {
  if (!db) return;
  try {
    // Disable foreign key checks temporarily
    await db.execute('SET FOREIGN_KEY_CHECKS = 0');
    await db.execute('DELETE FROM rentals');
    await db.execute('DELETE FROM cars');
    await db.execute('SET FOREIGN_KEY_CHECKS = 1');

    // Re-seed sample cars
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
  } catch (error) {
    console.error('Error cleaning database:', error);
  }
}

describe('Car Rental API - Integration Tests (MySQL)', () => {
  beforeAll(async () => {
    console.log(`\n📡 Connecting to MySQL at ${DB_HOST}:3306/${DB_NAME}...`);
    try {
      await connectDB();
      console.log('✅ Connected to MySQL');
    } catch (error) {
      console.error('❌ MySQL connection failed. Make sure docker-compose is running.');
      console.error('Run: docker-compose up -d');
      throw error;
    }
  }, 30000); // 30 second timeout for connection

  afterAll(async () => {
    if (db) {
      await db.end();
      console.log('✅ Disconnected from MySQL');
    }
  });

  beforeEach(async () => {
    // Clean up before each test
    await cleanDatabase();
    // Give app a moment to reset
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('API Availability', () => {
    test('should verify app is running and responsive', async () => {
      const res = await request(APP_URL).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OK');
      console.log('✅ App is running');
    });
  });

  describe('Cars Endpoint (MySQL)', () => {
    test('should fetch cars from database', async () => {
      const res = await request(APP_URL).get('/api/cars');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(3); // 3 seeded cars
      expect(res.body[0].make).toBe('Toyota');
    });

    test('should have correct car properties from database', async () => {
      const res = await request(APP_URL).get('/api/cars');
      const car = res.body[0];
      expect(car).toHaveProperty('id');
      expect(car).toHaveProperty('make');
      expect(car).toHaveProperty('model');
      expect(car).toHaveProperty('year');
      expect(car).toHaveProperty('daily_rate');
      expect(car).toHaveProperty('available');
      expect(car).toHaveProperty('created_at');
    });
  });

  describe('Rentals Workflow (MySQL)', () => {
    test('should create rental and persist to database', async () => {
      const createRes = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice Smith',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body).toHaveProperty('id');
      const rentalId = createRes.body.id;

      // Verify rental is in database
      const getRentalsRes = await request(APP_URL).get('/api/rentals');
      const rental = getRentalsRes.body.find(r => r.id === rentalId);
      expect(rental).toBeDefined();
      expect(rental.renter_name).toBe('Alice Smith');
    });

    test('should mark car unavailable after rental creation', async () => {
      await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const carsRes = await request(APP_URL).get('/api/cars');
      const car = carsRes.body.find(c => c.id === 1);
      expect(car.available).toBe(0);

      // Verify in database
      const [rows] = await db.execute('SELECT available FROM cars WHERE id = 1');
      expect(rows[0].available).toBe(0);
    });

    test('should reject rental for unavailable car', async () => {
      // First rental
      await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      // Try second rental for same car
      const res = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Bob',
          start_date: '2025-01-05',
          end_date: '2025-01-07'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not available');
    });

    test('should update rental and mark car available on return', async () => {
      // Create rental
      const createRes = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const rentalId = createRes.body.id;

      // Return car
      const updateRes = await request(APP_URL)
        .put(`/api/rentals/${rentalId}`)
        .send({ status: 'returned' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.status).toBe('returned');

      // Verify car is available again
      const carsRes = await request(APP_URL).get('/api/cars');
      const car = carsRes.body.find(c => c.id === 1);
      expect(car.available).toBe(1);

      // Verify in database
      const [rows] = await db.execute('SELECT available FROM cars WHERE id = 1');
      expect(rows[0].available).toBe(1);
    });

    test('should handle full rental workflow: create -> update -> return', async () => {
      // 1. Create rental
      const createRes = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 2,
          renter_name: 'Bob Johnson',
          start_date: '2025-02-01',
          end_date: '2025-02-05'
        });

      expect(createRes.status).toBe(201);
      const rentalId = createRes.body.id;
      expect(createRes.body.total_cost).toBe('187.50'); // 5 days * 37.50

      // 2. Verify rental exists
      let rentalsRes = await request(APP_URL).get('/api/rentals');
      let rental = rentalsRes.body.find(r => r.id === rentalId);
      expect(rental.status).toBe('ongoing');

      // 3. Update end date (extend rental)
      const updateRes = await request(APP_URL)
        .put(`/api/rentals/${rentalId}`)
        .send({ end_date: '2025-02-07' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.total_cost).toBe('262.50'); // 7 days * 37.50

      // 4. Mark as returned
      const returnRes = await request(APP_URL)
        .put(`/api/rentals/${rentalId}`)
        .send({ status: 'returned' });

      expect(returnRes.status).toBe(200);
      expect(returnRes.body.status).toBe('returned');

      // 5. Verify car is available
      const carsRes = await request(APP_URL).get('/api/cars');
      const car = carsRes.body.find(c => c.id === 2);
      expect(car.available).toBe(1);
    });
  });

  describe('Metrics Endpoint (MySQL)', () => {
    test('should return metrics with database data', async () => {
      const res = await request(APP_URL).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('uptime_seconds');
      expect(res.body).toHaveProperty('rentals');
      expect(res.body).toHaveProperty('revenue');
      expect(res.body.rentals).toHaveProperty('total');
      expect(res.body.rentals).toHaveProperty('active');
    });

    test('should track rentals in metrics', async () => {
      // Create two rentals
      await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 2,
          renter_name: 'Bob',
          start_date: '2025-01-05',
          end_date: '2025-01-07'
        });

      const metricsRes = await request(APP_URL).get('/metrics');
      expect(metricsRes.body.rentals.total).toBe(2);
      expect(metricsRes.body.rentals.active).toBe(2);
      expect(metricsRes.body.rentals.completed).toBe(0);
    });

    test('should separate active and completed rentals', async () => {
      // Create rental
      const createRes = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      // Return it
      await request(APP_URL)
        .put(`/api/rentals/${createRes.body.id}`)
        .send({ status: 'returned' });

      const metricsRes = await request(APP_URL).get('/metrics');
      expect(metricsRes.body.rentals.total).toBe(1);
      expect(metricsRes.body.rentals.active).toBe(0);
      expect(metricsRes.body.rentals.completed).toBe(1);
    });

    test('should calculate total revenue correctly', async () => {
      // Create rental: 2 days * 35.00 = 70.00
      await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-02'
        });

      // Create rental: 3 days * 37.50 = 112.50
      await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 2,
          renter_name: 'Bob',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const metricsRes = await request(APP_URL).get('/metrics');
      expect(metricsRes.body.revenue.total).toBe('182.50');
    });
  });

  describe('Error Handling (MySQL)', () => {
    test('should return 404 for non-existent car', async () => {
      const res = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 999,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    test('should return 404 for non-existent rental on update', async () => {
      const res = await request(APP_URL)
        .put('/api/rentals/999')
        .send({ status: 'returned' });

      expect(res.status).toBe(404);
    });

    test('should validate required fields', async () => {
      const res = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1
          // missing renter_name, start_date, end_date
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });
  });

  describe('Database Integrity', () => {
    test('should maintain referential integrity', async () => {
      const createRes = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const rentalId = createRes.body.id;

      // Verify car_id FK in database
      const [rentals] = await db.execute('SELECT car_id FROM rentals WHERE id = ?', [rentalId]);
      expect(rentals[0].car_id).toBe(1);

      // Verify car exists
      const [cars] = await db.execute('SELECT id FROM cars WHERE id = 1');
      expect(cars.length).toBe(1);
    });

    test('should have correct data types in database', async () => {
      const createRes = await request(APP_URL)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice Smith',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const rentalId = createRes.body.id;

      const [rentals] = await db.execute('SELECT * FROM rentals WHERE id = ?', [rentalId]);
      const rental = rentals[0];

      expect(typeof rental.car_id).toBe('number');
      expect(typeof rental.renter_name).toBe('string');
      expect(rental.start_date instanceof Date).toBe(true);
      expect(rental.end_date instanceof Date).toBe(true);
      expect(typeof parseFloat(rental.total_cost)).toBe('number');
      expect(['ongoing', 'returned', 'cancelled']).toContain(rental.status);
    });
  });
});
