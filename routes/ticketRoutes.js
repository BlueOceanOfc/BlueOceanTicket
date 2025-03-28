const express = require('express');
const router = express.Router();
const { responderTicket } = require('../controllers/ticketController'); // Importa o controller

// Rota para responder ao ticket
router.post('/responder-ticket', responderTicket); // Envia o ticketId e a mensagem

module.exports = router;
