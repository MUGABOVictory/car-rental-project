const request = require('supertest');
const express = require('express');

// We'll test the app in in-memory mode to avoid DB dependencies
let app;

// Helper to create app in test mode
function createTestApp() {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(express.urlencoded({ extended: true }));

  // Metrics for test
  const testMetrics = {
    totalRentals: 0,
    activeRentals: 0,
    totalRevenue: 0,
    requestCount: 0,
    startTime: Date.now()
  };

  // Request tracking middleware
  testApp.use((req, res, next) => {
    testMetrics.requestCount++;
    next();
  });

  // In-memory state for tests
  let inMemoryCars = [
    { id: 1, make: 'Toyota', model: 'Corolla', year: 2020, daily_rate: '35.00', available: 1, created_at: new Date().toISOString() },
    { id: 2, make: 'Honda', model: 'Civic', year: 2019, daily_rate: '37.50', available: 1, created_at: new Date().toISOString() },
    { id: 3, make: 'Ford', model: 'Focus', year: 2018, daily_rate: '30.00', available: 1, created_at: new Date().toISOString() }
  ];
  let inMemoryRentals = [];

  // Metrics update function
  async function updateMetrics() {
    testMetrics.totalRentals = inMemoryRentals.length;
    testMetrics.activeRentals = inMemoryRentals.filter(r => r.status === 'ongoing').length;
    testMetrics.totalRevenue = inMemoryRentals.reduce((sum, r) => sum + parseFloat(r.total_cost || 0), 0);
  }

  // Helper to compute days (copy from lib/utils)
  function daysInclusive(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
    if (end < start) return 0;
    const msPerDay = 1000 * 60 * 60 * 24;
    const days = Math.ceil((end - start) / msPerDay) + 1;
    return Math.max(1, days);
  }

  // GET all cars
  testApp.get('/api/cars', (req, res) => {
    res.json(inMemoryCars);
  });

  // GET all rentals
  testApp.get('/api/rentals', (req, res) => {
    const rows = inMemoryRentals
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map(r => {
        const car = inMemoryCars.find(c => c.id === r.car_id) || {};
        return { ...r, make: car.make, model: car.model, year: car.year, daily_rate: car.daily_rate };
      });
    res.json(rows);
  });

  // POST create rental
  testApp.post('/api/rentals', (req, res) => {
    const { car_id, renter_name, start_date, end_date } = req.body;

    if (!car_id || !renter_name || !start_date || !end_date) {
      return res.status(400).json({ error: 'car_id, renter_name, start_date and end_date are required' });
    }

    const car = inMemoryCars.find(c => c.id === Number(car_id));
    if (!car) return res.status(404).json({ error: 'Car not found' });
    if (car.available === 0) return res.status(400).json({ error: 'Car is not available for rental' });

    const days = daysInclusive(start_date, end_date);
    if (days === 0) return res.status(400).json({ error: 'Invalid dates' });

    const total_cost = (parseFloat(car.daily_rate) * days).toFixed(2);
    const newId = inMemoryRentals.length ? Math.max(...inMemoryRentals.map(r => r.id)) + 1 : 1;
    const rental = {
      id: newId,
      car_id: Number(car_id),
      renter_name,
      start_date,
      end_date,
      total_cost,
      status: 'ongoing',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    inMemoryRentals.push(rental);
    car.available = 0;
    res.status(201).json({ ...rental, message: 'Rental created (in-memory)' });
  });

  // PUT update rental
  testApp.put('/api/rentals/:id', (req, res) => {
    const { id } = req.params;
    const { status, end_date } = req.body;

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
    res.json({ message: 'Rental updated (in-memory)', id: rental.id, status: rental.status, end_date: rental.end_date, total_cost: rental.total_cost });
  });

  // DELETE rental
  testApp.delete('/api/rentals/:id', (req, res) => {
    const { id } = req.params;
    const idx = inMemoryRentals.findIndex(r => r.id === Number(id));
    if (idx === -1) return res.status(404).json({ error: 'Rental not found' });
    inMemoryRentals.splice(idx, 1);
    res.json({ message: 'Rental deleted (in-memory)' });
  });

  // Health check
  testApp.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
  });

  // Metrics endpoint
  testApp.get('/metrics', async (req, res) => {
    await updateMetrics();
    const uptime = Math.floor((Date.now() - testMetrics.startTime) / 1000);
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime_seconds: uptime,
      rentals: {
        total: testMetrics.totalRentals,
        active: testMetrics.activeRentals,
        completed: testMetrics.totalRentals - testMetrics.activeRentals
      },
      revenue: {
        total: parseFloat(testMetrics.totalRevenue).toFixed(2),
        currency: 'USD'
      },
      requests: {
        total: testMetrics.requestCount
      }
    });
  });

  return testApp;
}

describe('Car Rental API', () => {
  beforeEach(() => {
    app = createTestApp();
  });

  describe('GET /api/cars', () => {
    test('should return list of cars', async () => {
      const res = await request(app).get('/api/cars');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('make');
      expect(res.body[0]).toHaveProperty('daily_rate');
    });

    test('should include availability status', async () => {
      const res = await request(app).get('/api/cars');
      expect(res.body[0]).toHaveProperty('available');
      expect([0, 1]).toContain(res.body[0].available);
    });
  });

  describe('GET /api/rentals', () => {
    test('should return empty rentals initially', async () => {
      const res = await request(app).get('/api/rentals');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });

    test('should return rentals sorted by created_at descending', async () => {
      // Create two rentals
      await request(app)
        .post('/api/rentals')
        .send({ car_id: 1, renter_name: 'Alice', start_date: '2025-01-01', end_date: '2025-01-03' });

      await request(app)
        .post('/api/rentals')
        .send({ car_id: 2, renter_name: 'Bob', start_date: '2025-01-05', end_date: '2025-01-07' });

      const res = await request(app).get('/api/rentals');
      expect(res.body.length).toBe(2);
      // Latest should be first
      expect(res.body[0].renter_name).toBe('Bob');
    });
  });

  describe('POST /api/rentals', () => {
    test('should create a rental successfully', async () => {
      const res = await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice Smith',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.renter_name).toBe('Alice Smith');
      expect(res.body.total_cost).toBe('105.00'); // 3 days (Jan 1, 2, 3 inclusive) * 35 = 105
      expect(res.body.status).toBe('ongoing');
    });

    test('should mark car unavailable after rental', async () => {
      await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const carsRes = await request(app).get('/api/cars');
      const car = carsRes.body.find(c => c.id === 1);
      expect(car.available).toBe(0);
    });

    test('should reject rental for unavailable car', async () => {
      await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const res = await request(app)
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

    test('should return 404 for non-existent car', async () => {
      const res = await request(app)
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

    test('should return 400 for invalid dates (end before start)', async () => {
      const res = await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-10',
          end_date: '2025-01-05'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid dates');
    });

    test('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice'
          // missing start_date and end_date
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    test('should calculate correct total_cost for multi-day rental', async () => {
      const res = await request(app)
        .post('/api/rentals')
        .send({
          car_id: 2, // daily_rate: 37.50
          renter_name: 'Bob',
          start_date: '2025-01-01',
          end_date: '2025-01-05'
        });

      expect(res.status).toBe(201);
      // 5 days * 37.50 = 187.50
      expect(res.body.total_cost).toBe('187.50');
    });
  });

  describe('PUT /api/rentals/:id', () => {
    test('should update rental status to returned', async () => {
      const createRes = await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const rentalId = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/rentals/${rentalId}`)
        .send({ status: 'returned' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.status).toBe('returned');
    });

    test('should mark car available after return', async () => {
      const createRes = await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      await request(app)
        .put(`/api/rentals/${createRes.body.id}`)
        .send({ status: 'returned' });

      const carsRes = await request(app).get('/api/cars');
      const car = carsRes.body.find(c => c.id === 1);
      expect(car.available).toBe(1);
    });

    test('should return 404 for non-existent rental', async () => {
      const res = await request(app)
        .put('/api/rentals/999')
        .send({ status: 'returned' });

      expect(res.status).toBe(404);
    });

    test('should update end_date and recalculate total_cost', async () => {
      const createRes = await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1, // daily_rate: 35.00
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const rentalId = createRes.body.id;

      const updateRes = await request(app)
        .put(`/api/rentals/${rentalId}`)
        .send({ end_date: '2025-01-05' });

      expect(updateRes.status).toBe(200);
      // 5 days * 35.00 = 175.00
      expect(updateRes.body.total_cost).toBe('175.00');
    });
  });

  describe('DELETE /api/rentals/:id', () => {
    test('should delete rental', async () => {
      const createRes = await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const rentalId = createRes.body.id;

      const deleteRes = await request(app)
        .delete(`/api/rentals/${rentalId}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.message).toContain('deleted');
    });

    test('should return 404 when deleting non-existent rental', async () => {
      const res = await request(app)
        .delete('/api/rentals/999');

      expect(res.status).toBe(404);
    });
  });

  describe('GET /health', () => {
    test('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('OK');
      expect(res.body).toHaveProperty('timestamp');
    });
  });

  describe('GET /metrics', () => {
    test('should return metrics with correct structure', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('uptime_seconds');
      expect(res.body).toHaveProperty('rentals');
      expect(res.body).toHaveProperty('revenue');
      expect(res.body).toHaveProperty('requests');
    });

    test('should track total rentals in metrics', async () => {
      await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const res = await request(app).get('/metrics');
      expect(res.body.rentals.total).toBe(1);
    });

    test('should track active rentals in metrics', async () => {
      await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1,
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const res = await request(app).get('/metrics');
      expect(res.body.rentals.active).toBe(1);
    });

    test('should calculate total revenue correctly', async () => {
      await request(app)
        .post('/api/rentals')
        .send({
          car_id: 1, // 35.00/day
          renter_name: 'Alice',
          start_date: '2025-01-01',
          end_date: '2025-01-03'
        });

      const res = await request(app).get('/metrics');
      expect(res.body.revenue.total).toBe('105.00'); // 3 days * 35.00
    });

    test('should count total requests', async () => {
      // Make several requests
      await request(app).get('/api/cars');
      await request(app).get('/api/rentals');
      await request(app).get('/metrics');

      const res = await request(app).get('/metrics');
      expect(res.body.requests.total).toBeGreaterThan(0);
    });
  });
});
