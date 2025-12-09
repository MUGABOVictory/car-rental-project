# Car Rental Service - DevOps Ready

A professional car rental management system built with Node.js, Express, and MySQL with comprehensive DevOps monitoring and multi-table database design for rental logistics.

## 🚗 Features

- **Car Fleet Management**: Track available and rented vehicles
- **Rental Operations**: Create, track, and manage rental agreements
- **Automated Pricing**: Dynamic cost calculation based on rental duration
- **Rental Status Tracking**: Monitor ongoing, completed, and cancelled rentals
- **Responsive UI**: Modern Bootstrap-based frontend
- **REST API**: Complete RESTful endpoints for fleet and rental management
- **MySQL Multi-Table**: Normalized database with cars and rentals tables
- **Health Monitoring**: Health check and DevOps metrics endpoints
- **Docker Containerization**: Production-ready Docker setup
- **Request Tracking**: Built-in metrics for usage monitoring

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Database Schema](#database-schema)
- [Docker Setup](#docker-setup)
- [DevOps Monitoring](#devops-monitoring)
- [Environment Variables](#environment-variables)

## 🏁 Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8.0+ (or use Docker Compose)
- Docker & Docker Compose (optional)

### Local Development

1. **Install dependencies:**
```bash
npm install
```

2. **Set up MySQL database:**
```bash
# Using Docker Compose (recommended)
docker-compose up -d

# OR manually create database
mysql -u root -p
CREATE DATABASE car_rental_db;
```

3. **Start the application:**
```bash
# Development with auto-reload
npm run dev

# Production
npm start
```

4. **Access the application:**
- Frontend: http://localhost:3000
- Health Check: http://localhost:3000/health
- Metrics: http://localhost:3000/metrics

## 📁 Project Structure

```
.
├── index.js                 # Express server & API endpoints
├── package.json             # Dependencies and scripts
├── Dockerfile               # Multi-stage container build
├── docker-compose.yml       # MySQL + Node.js service setup
├── healthcheck.js           # Docker health check script
├── public/
│   └── index.html           # SPA frontend
└── README.md               # This file
```

## 🔌 API Endpoints

### Cars API

**GET /api/cars**
- Retrieve all available and rented cars
- Response: Array of car objects
```json
{
  "id": 1,
  "make": "Toyota",
  "model": "Corolla",
  "year": 2020,
  "daily_rate": 35.00,
  "available": true
}
```

### Rentals API

**GET /api/rentals**
- List all rentals with car information
- Response: Array of rental objects with joined car data

**POST /api/rentals**
- Create a new rental agreement
- Body:
```json
{
  "car_id": 1,
  "renter_name": "John Doe",
  "start_date": "2025-01-01",
  "end_date": "2025-01-05"
}
```
- Auto-calculates total_cost based on daily_rate and duration
- Marks car as unavailable

**PUT /api/rentals/:id**
- Update rental status or end date
- Body:
```json
{
  "status": "returned",
  "end_date": "2025-01-10"
}
```
- Recalculates cost if end_date changes
- Auto-marks car as available when status='returned'

**DELETE /api/rentals/:id**
- Delete a rental record

### System Endpoints

**GET /health**
- Health check for container orchestration
- Response: `{ "status": "OK", "timestamp": "..." }`

**GET /metrics**
- DevOps monitoring metrics
- Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-10T12:00:00Z",
  "uptime_seconds": 3600,
  "rentals": {
    "total": 15,
    "active": 3,
    "completed": 12
  },
  "revenue": {
    "total": "1250.50",
    "currency": "USD"
  },
  "requests": {
    "total": 234
  }
}
```

## 🗄️ Database Schema

### cars table
```sql
CREATE TABLE cars (
  id INT AUTO_INCREMENT PRIMARY KEY,
  make VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  year INT,
  daily_rate DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  available TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

### rentals table
```sql
CREATE TABLE rentals (
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
)
```

## 🐳 Docker Setup

### Using Docker Compose (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down
```

**Services:**
- **app**: Node.js application on port 8001 (container port 3000)
- **mysql**: MySQL 8.0 on port 3306

### Configuration

The `docker-compose.yml` includes:
- Automatic database initialization
- Health checks for both services
- Volume persistence for MySQL data
- Environment variables for configuration
- Service dependency management

## 📊 DevOps Monitoring

The application provides comprehensive metrics for monitoring:

### Metrics Endpoint (`/metrics`)
- **Uptime**: Service availability tracking
- **Rental Metrics**: Total, active, and completed rentals
- **Revenue Tracking**: Total revenue generated
- **Request Count**: API usage statistics

### Health Check (`/health`)
- Kubernetes/Docker readiness probe compatible
- Fast response for load balancer checks

### Request Tracking
- Automatic request counting middleware
- Provides usage insights for capacity planning

## 🔐 Environment Variables

Configure via `.env` or `docker-compose.yml`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_HOST` | localhost | MySQL host |
| `DB_USER` | root | Database user |
| `DB_PASSWORD` | password | Database password |
| `DB_NAME` | car_rental_db | Database name |
| `PORT` | 3000 | Application port |
| `NODE_ENV` | production | Environment mode |

## 🚀 Deployment

### Using Docker Compose
```bash
docker-compose up -d
```

### Using Kubernetes
- Container image: `node:18-alpine` (production stage)
- Health endpoint: `/health`
- Metrics endpoint: `/metrics`
- Port: 3000

### Environment-Specific Setup
```bash
# Development
NODE_ENV=development npm run dev

# Production
NODE_ENV=production npm start
```

## 📈 Monitoring Usage

Monitor the fleet and rental business metrics:

```bash
curl http://localhost:3000/metrics | jq '.'
```

Track:
- Active rental agreements
- Total revenue generated
- Fleet utilization
- Request volume

## 🎯 DevOps Features

✅ **Multi-table MySQL database** - Normalized schema for scalability  
✅ **Health check endpoints** - Kubernetes-ready  
✅ **Metrics API** - Prometheus-compatible monitoring  
✅ **Docker containerization** - Multi-stage builds for size optimization  
✅ **Auto-recovery** - Restart policies and dependency management  
✅ **Data persistence** - Volume management for database  
✅ **Request tracking** - Usage analytics  

## 📝 Sample Data

The application seeds sample cars on first run:
- Toyota Corolla 2020: $35/day
- Honda Civic 2019: $37.50/day
- Ford Focus 2018: $30/day

## 🛠️ Development Scripts

```bash
npm start      # Start production server
npm run dev    # Start with auto-reload (nodemon)
npm test       # Run tests (jest)
npm run lint   # Lint code (eslint)
npm run lint:fix # Auto-fix linting issues
```

## 📝 License

MIT - See LICENSE file for details

## 👨‍💼 Author

DevOps Student - Car Rental Project for DevOps Learning
