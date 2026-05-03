const router = require('express').Router();
const company = require('../config/company');

router.get('/company', (req, res) => {
  res.json(company);
});

module.exports = router;