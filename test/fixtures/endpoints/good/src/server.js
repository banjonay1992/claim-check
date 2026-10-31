import express from 'express';

const app = express();
const router = express.Router();

app.get('/health', (req, res) => res.send('ok'));
router.get('/users/:id', (req, res) => res.json({}));
router.post('/users', (req, res) => res.status(201).end());
app.use('/api', router);
