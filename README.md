Tech Stack:

Frontend: React (Vite or CRA)

Backend: Node.js + Express

Database: MySQL

Security: JWT, bcrypt, environment variables

Architecture: REST API (clean separation)


System Architecture:

React Dashboard (Frontend)
   ↓ HTTPS (REST API)
Node.js + Express (Backend)
   ↓ SQL Queries (Parameterized)
MySQL Database


React NEVER connects directly to MySQL
Backend handles auth, validation, security

Mental model (remember this forever):
Categories.jsx → UI + React state
api.js → fetch calls
routes/categories.js → Express + MySQL


cd inventory-frontend
npm run dev

SKU stands for Stock Keeping Unit.

