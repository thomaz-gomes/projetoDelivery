// Addresses API removed. Kept a minimal, inert router to avoid accidental imports breaking builds.
import express from 'express';

export const addressesRouter = express.Router();

// All endpoints respond with 404 / removed message
addressesRouter.get('/', (req, res) => res.status(404).json({ message: 'Addresses API removed' }));
addressesRouter.get('/:id', (req, res) => res.status(404).json({ message: 'Addresses API removed' }));
addressesRouter.post('/', (req, res) => res.status(404).json({ message: 'Addresses API removed' }));
addressesRouter.patch('/:id', (req, res) => res.status(404).json({ message: 'Addresses API removed' }));
addressesRouter.delete('/:id', (req, res) => res.status(404).json({ message: 'Addresses API removed' }));
