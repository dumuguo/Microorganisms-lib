const bcrypt = require('bcryptjs');
const saltRounds = 8;

if (process.argv.length < 3) {
  console.error('Usage: node generate_hash.js <password>');
  process.exit(1);
}

const password = process.argv[2];
const hash = Buffer.from(bcrypt.hashSync(password, saltRounds)).toString('base64');
console.log(hash);
