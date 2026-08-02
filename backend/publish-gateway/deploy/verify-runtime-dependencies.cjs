#!/usr/bin/env node
// Release-candidate smoke test: require and execute the SQLite native binding.
const Database = require('better-sqlite3');

const db = new Database(':memory:');
const result = db.prepare('SELECT 1 AS ok').get();
db.close();
if (result.ok !== 1) process.exit(1);
